/**
 * Markdown Radio — 공통 계약 (SSOT)
 *
 * 이 파일은 03-functional-spec.md 의 데이터 모델/인터페이스를 코드로 옮긴 단일 출처다.
 * 모든 모듈(refine / engine / ui)은 이 타입에만 의존한다. 구현 세부는 각 모듈에 둔다.
 *
 * ⚠️ 핵심 불변식(FN-03): 청크의 (startOffset, endOffset) 은 항상 원문의 올바른 범위를 가리킨다.
 *    북마크 점프·하이라이트가 이 불변식 위에 선다. 자세한 규칙은 아래 Chunk 주석 참고.
 */

// ─────────────────────────────────────────────────────────────
// FN-01 · 문서 입력
// ─────────────────────────────────────────────────────────────
export type SourceType = 'file' | 'paste'

export interface RawDocument {
  id: string
  title: string
  rawText: string
  sourceType: SourceType
  createdAt: number
}

// ─────────────────────────────────────────────────────────────
// FN-02 · 마크다운 정제
// ─────────────────────────────────────────────────────────────
/**
 * 정제된 블록. remark(mdast) 노드의 position.offset 기반으로 원문을 slice 해 만든다.
 * mdast-util-to-string 처럼 오프셋을 잃는 변환은 금지(원문↔재생↔북마크 매핑이 깨진다).
 *
 * 03 명세 대비 확장: startOffset/endOffset(원문 문자 오프셋)을 추가했다.
 * 청크의 offset(FN-03)과 북마크 불변식의 토대가 되므로, 정제 단계에서 반드시 보존한다.
 */
export interface CleanBlock {
  text: string // 정제된 평문(마커 제거)
  isHeading: boolean // 헤더 여부(무음 연출용)
  headingLevel?: number // 1~6
  sourceLineStart: number // 원문 행(0-based)
  sourceLineEnd: number
  startOffset: number // 원문 문자 오프셋(시작, 0-based) — 이 블록 텍스트가 유래한 범위
  endOffset: number // 원문 문자 오프셋(끝, exclusive)
}

/** 정제 설정(사용자 토글) — FN-02 */
export interface RefineOptions {
  /** 코드블록: true=건너뛰기(기본), false=읽기 */
  skipCodeBlocks: boolean
  /** 표: 건너뛰기(기본) / 셀 나열 */
  tableMode: 'skip' | 'list'
  /** 이미지 alt: 무시(기본) / 읽기 */
  readImageAlt: boolean
}

export const DEFAULT_REFINE_OPTIONS: RefineOptions = {
  skipCodeBlocks: true,
  tableMode: 'skip',
  readImageAlt: false,
}

// ─────────────────────────────────────────────────────────────
// FN-03 · 문장 청크 분할
// ─────────────────────────────────────────────────────────────
export type ChunkKind = 'speech' | 'silence'

/**
 * 재생·합성·북마크의 최소 단위.
 *
 * 불변식(MUST · 강제):
 *  - (startOffset, endOffset) 은 항상 원문의 실제 범위를 가리킨다.
 *  - 정규화(마크다운 마커·연속공백 제거) 후 비교 시
 *      normalize(sourceText.slice(startOffset, endOffset)) === normalize(text)
 *    가 성립해야 한다. (마커가 없는 순수 문장은 엄격 일치)
 *  - kind==='silence'(무음, text==='')는 검사 대상에서 제외.
 *  - 이 불변식을 빌드타임 + 런타임 양쪽에서 assert 로 강제한다.
 */
export interface Chunk {
  index: number // 0-based 순번
  text: string // 합성할 평문(무음 청크는 "")
  startOffset: number // 원문 문자 오프셋(시작, 0-based)
  endOffset: number // 원문 문자 오프셋(끝, exclusive)
  kind: ChunkKind
  silenceMs?: number // kind==='silence'일 때
  isHeading?: boolean // 헤더에서 유래(UI/연출용)
  // 합성 후(audioBuffer 경로에서만) 채워짐:
  durationSec?: number
  audioRef?: string
}

/** 청크 분할 설정 — FN-03 */
export interface ChunkOptions {
  /** 한 청크 최대 글자수(기본 200). Chrome speechSynthesis 15초 침묵 버그 회피 사유 포함 */
  maxChars: number
  /** 이보다 짧은 청크는 다음과 병합(기본 10). 헤더는 단독 유지 가능 */
  minChars: number
  /** 헤더 블록 뒤 무음 청크 삽입 */
  silenceAfterHeading: boolean
  /** 헤더 뒤 무음 길이(ms) */
  headingSilenceMs: number
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChars: 200,
  minChars: 10,
  silenceAfterHeading: true,
  headingSilenceMs: 1500,
}

// ─────────────────────────────────────────────────────────────
// FN-04 · 재생 엔진 RadioEngine (얇은 façade)
// ─────────────────────────────────────────────────────────────
/** 위치의 단일 진실 — 시간(ms)이 아니라 청크 인덱스 기반 */
export interface EnginePosition {
  chunkIndex: number
  charOffset: number // 청크 내 상대 오프셋(원문 위치 = chunk.startOffset + charOffset)
}

export type EngineEvent = 'chunkChange' | 'end'

/**
 * UI가 보는 유일한 재생 표면. 실제 TTS 백엔드(speechSynthesis 등)는
 * 어댑터 뒤에 격리한다(이 시그니처에 브라우저 API 노출 금지).
 */
export interface RadioEngine {
  load(chunks: Chunk[]): Promise<void>
  play(): void
  pause(): void
  stop(): void
  seekToChunk(i: number): void // 모든 점프의 단일 진입점
  setRate(rate: number): void // FN-08 배속(재생단 통일, 피치 보존)
  readonly position: EnginePosition
  on(event: EngineEvent, cb: (p: EnginePosition) => void): void
  off(event: EngineEvent, cb: (p: EnginePosition) => void): void
  /** 계측용 문서 컨텍스트 주입(선택 기능). 통합 단계에서 문서 로드 시 호출 → 재생 계측이 올바른 docId/docHash 로 적재된다. */
  setDocContext?(ctx: { docId: string; docHash: string } | null): void
  /** 사용 가능한 한국어 음성 목록(Web Speech 한정, UI 드롭다운용). */
  getKoreanVoices?(): { uri: string; name: string }[]
  /** 음성 선택(voiceURI). null이면 기본 선택 로직(남성 우선). */
  setVoice?(uri: string | null): void
  /** 현재 선택된 음성의 URI(UI 표시 동기화용). */
  readonly currentVoiceURI?: string | null
  /** 백엔드가 제공할 때만 채워지는 선택 능력 */
  readonly capabilities: {
    wordBoundary?: boolean // onboundary 로 단어 단위 charOffset 갱신 가능
    audioBuffer?: boolean // PCM/AudioBuffer 경로(시간 기반 seek) 가능
  }
}

// ─────────────────────────────────────────────────────────────
// FN-06 · 재생 상태
// ─────────────────────────────────────────────────────────────
export type PlaybackState =
  | 'idle'
  | 'loading-model'
  | 'synthesizing'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error'

export interface PlayerStatus {
  state: PlaybackState
  currentChunk: number // 위치의 단일 진실(SSOT)
  totalChunks: number
  bufferedChunks: number
  // audioBuffer 경로(후순위)에서만:
  globalTimeSec?: number
  totalEstimatedSec?: number
}

// ─────────────────────────────────────────────────────────────
// FN-09 · 북마크
// ─────────────────────────────────────────────────────────────
export interface Bookmark {
  id: string
  documentId: string
  chunkIndex: number // 위치의 진실
  charOffset: number // 청크 내 상대 오프셋(원문 위치 = chunk.startOffset + charOffset)
  previewText: string
  createdAt: number
  note?: string // Post-MVP
}

// ─────────────────────────────────────────────────────────────
// FN-11 · 문서 라이브러리(저장 단위)
// ─────────────────────────────────────────────────────────────
export interface StoredDocument {
  id: string
  title: string
  rawText: string
  cleanBlocks?: CleanBlock[] // 캐시(재정제 생략)
  chunks?: Chunk[]
  lastChunkIndex?: number // 이어듣기(위치=청크 인덱스)
  createdAt: number
  updatedAt: number
}

// ─────────────────────────────────────────────────────────────
// 설정 — settings store
// ─────────────────────────────────────────────────────────────
export type ThemePref = 'light' | 'dark' | 'system'
export type EngineKind = 'webspeech' | 'supertonic'
/** Supertonic 합성 품질 프리셋 — 엔진에서 totalStep(추론 횟수)로 매핑(빠름5/표준8/고품질12). */
export type TtsQuality = 'fast' | 'standard' | 'high'

export interface Settings {
  rate: number // 배속(FN-08), 기본 1.0
  theme: ThemePref
  engine: EngineKind // 현재 'webspeech'(부트스트랩). 정체성은 'supertonic'
  ttsQuality: TtsQuality // Supertonic 합성 품질(totalStep 매핑). 기본 'standard'(=step 8)
  voiceURI?: string // 선택한 Web Speech 음성
  refine: RefineOptions
  chunk: ChunkOptions
}

export const DEFAULT_SETTINGS: Settings = {
  rate: 1.0,
  theme: 'system',
  engine: 'webspeech',
  ttsQuality: 'standard',
  refine: DEFAULT_REFINE_OPTIONS,
  chunk: DEFAULT_CHUNK_OPTIONS,
}

// ─────────────────────────────────────────────────────────────
// FN-13 · 계측 (Instrumentation) — 지표 정의 SSOT
// ─────────────────────────────────────────────────────────────
export type EventType =
  | 'doc_open'
  | 'chunk_play_start'
  | 'chunk_play_end'
  | 'bookmark_add'
  | 'bookmark_click'
  | 'jump_resolved'
  | 'manual_seek' // 패시브 계측만(점수화 금지)
  | 'read_scroll' // 패시브 계측만(점수화 금지)

export interface InstrumentationEvent {
  type: EventType
  ts: number // epoch ms
  sessionId: string // 30분 gap 으로 절단
  docId: string
  docHash: string // 원문 해시(같은 문서 재오픈 식별)
  chunkIndex?: number
  visible: boolean // document.visibilityState === 'visible'
}
