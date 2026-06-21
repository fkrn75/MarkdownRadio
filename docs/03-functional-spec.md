# 03 · 세부 기능명세서 (Functional Specification)

> Markdown Radio v1.0 · 2026-06-21
> 각 기능의 동작·입출력·UI·데이터·엣지케이스를 정의한다. 구현 체크리스트는 [04-checklist.md](04-checklist.md).

## 표기
- **MUST** 필수 / **SHOULD** 권장 / **MAY** 선택
- 식별자 `FN-xx`, 데이터 타입 `TypeScript` 표기

---

## 0. 시스템 아키텍처 개요

```
[UI/Svelte] ─ 메인 스레드
   │  업로드·정제·청크·재생제어·북마크·정독뷰
   ▼
[TTS Worker] ─ Web Worker
   │  engine.synth(text) → Float32 PCM (+ sampleRate)
   ▼
[TTS Engine 추상화] engine.ts
   ├─ transformersEngine (Supertonic / MMS, WebGPU·WASM)
   └─ sherpaEngine (WASM 폴백)
   │  모델 로딩 ← [IndexedDB modelCache]
   ▼
[AudioPlayer]
   ├─ WebAudioPlayer (PC/Android, 청크 큐·gapless)
   └─ AudioElementPlayer (iOS, 이어붙인 WAV Blob)
[저장] IndexedDB: documents / bookmarks / settings / models
[PWA] Service Worker(앱셸) + manifest + MediaSession
```

---

## FN-01 · 문서 입력

### 동작
- **MUST** 두 입력 방식 지원:
  1. **파일 업로드**: `.md`, `.markdown`, `.txt` (드래그앤드롭 + 파일 선택 버튼)
  2. **텍스트 붙여넣기**: 텍스트 영역에 직접 입력/붙여넣기 → "읽기" 버튼
- **MUST** 파일은 `FileReader.readAsText`로 UTF-8 디코딩.
- **SHOULD** 입력 시 문서명 자동 추출: 파일명 또는 첫 번째 `# 헤더` 또는 첫 줄 30자.
- **SHOULD** 업로드 즉시 IndexedDB `documents`에 원문 보존(새로고침 후에도 유지).

### 입출력
- 입력: `File | string`
- 출력: `RawDocument { id, title, rawText, sourceType, createdAt }`

### 엣지케이스
| 상황 | 처리 |
|------|------|
| 빈 파일/공백만 | "내용이 없습니다" 토스트, 진행 중단 |
| 매우 큰 파일(>1MB) | 경고 + 계속 진행(청크가 많아짐 안내). **MUST** 하드 상한 없음, **SHOULD** 5MB 초과 시 확인 |
| 비UTF-8 인코딩 | 디코딩 실패 시 "지원하지 않는 인코딩" 안내 |
| `.docx`·`.pdf` 등 | 거부 + "MD/TXT만 지원" 안내 |

---

## FN-02 · 마크다운 정제 엔진 ★ 핵심

마크다운을 TTS가 자연스럽게 읽을 **평문**으로 변환한다. 라이브러리(`markdown-to-txt` 등) 기반 + 커스텀 규칙.

### 정제 규칙 (요소별)

| 마크다운 요소 | 처리 | 비고 |
|---------------|------|------|
| `# ~ ###### 헤더` | 텍스트만 남김 + **헤더 플래그** 부여(FN-03 무음용) | 마커 `#` 제거 |
| `**굵게**` `*기울임*` `~~취소~~` | 마커 제거, 텍스트만 | |
| `` `인라인 코드` `` | **SHOULD** 내용 읽되 짧으면 그대로, 식별자성이면 유지 | 설정으로 "코드 건너뛰기" 토글 |
| ` ```코드블록``` ` | **MUST** 기본 **건너뜀**(읽지 않음) → "(코드 블록 생략)" 또는 완전 침묵(설정) | 청취 소음 방지 |
| `[링크텍스트](url)` | **MUST** 링크 텍스트만 읽고 URL 제거 | |
| `![alt](img)` 이미지 | **MUST** 제거(또는 alt만, 설정) | |
| `\| 표 \|` | **MUST** 기본 건너뜀 또는 셀을 "A, B, C" 나열(설정) | |
| `- / 1. 리스트` | 마커 제거, 항목을 문장으로. **MAY** 항목 사이 짧은 쉼 | |
| `> 인용` | 마커 제거, 본문만 | |
| `---` 구분선 | 제거(+ **MAY** 짧은 무음) | |
| URL 원문(`https://...`) | **MUST** "링크" 한 단어로 치환 또는 제거 | 긴 URL 읽기 방지 |
| 이모지 | **SHOULD** 제거 또는 무시 | |
| 각주 `[^1]` | 제거 | |
| HTML 태그 | 제거 | |
| 연속 공백/빈 줄 | 단일 공백/문단 경계로 정규화 | |

### 출력
- `CleanBlock[]` — 정제된 블록 배열. 각 블록은 원문 행 범위를 보존:
```typescript
interface CleanBlock {
  text: string;          // 정제된 평문
  isHeading: boolean;    // 헤더 여부(무음 연출용)
  headingLevel?: number; // 1~6
  sourceLineStart: number; // 원문 행(0-based)
  sourceLineEnd: number;
}
```

### 설정 (사용자 토글)
- 코드블록: 건너뛰기(기본) / 읽기
- 표: 건너뛰기(기본) / 셀 나열
- 이미지 alt: 무시(기본) / 읽기

### 엣지케이스
- 닫히지 않은 코드블록 → 문서 끝까지 코드로 간주하지 말고 휴리스틱(다음 헤더에서 종료).
- 중첩 리스트 → 깊이 무시, 평탄화.
- 표 안 마크다운 → 정제 후 나열.

---

## FN-03 · 문장 청크 분할

정제된 블록을 **재생·합성·북마크의 최소 단위인 청크**로 나눈다.

### 규칙
- **MUST** 문장 경계로 분할: 한국어 종결(`. ! ? …` + 줄바꿈), 단 `예: 3.14`, `Dr.`, 약어 보호.
- **MUST** 한 청크가 너무 길면(> 설정값, 기본 **200자**) 쉼표/접속사/공백에서 강제 분할 → 합성 지연·메모리 관리.
- **MUST** 너무 짧은 청크(< 10자)는 다음 청크와 병합(과도한 끊김 방지). 단 헤더는 단독 유지 가능.
- **MUST** 각 청크에 원문 위치 메타 부여(FN-09 북마크용).
- **SHOULD** 헤더 블록 다음에 **무음 청크**(1.5~2초) 삽입 옵션 → 라디오 코너 전환 연출.

### 데이터
```typescript
interface Chunk {
  index: number;            // 0-based 순번
  text: string;             // 합성할 평문 (무음 청크는 "")
  kind: 'speech' | 'silence';
  silenceMs?: number;       // kind==='silence'일 때
  sourceLineStart: number;  // 원문 행
  sourceCharOffset: number; // 원문 문자 오프셋
  // 합성 후 채워짐:
  durationSec?: number;
  audioRef?: string;        // 메모리/캐시 참조
}
```

### 파생: prefix-sum
- 합성으로 `durationSec`가 정해지면 `cumStart[i] = Σ duration[0..i-1]` 계산 → 재생위치↔청크 역산(FN-09).

---

## FN-04 · TTS 합성 엔진 (추상화) ★ 핵심

모델/런타임을 교체 가능하게 **단일 인터페이스**로 추상화한다.

### 인터페이스
```typescript
interface TTSEngine {
  readonly id: string;                 // 'supertonic' | 'melotts-ko' | 'mms-ko'
  readonly sampleRate: number;
  init(opts: {
    onProgress?: (ratio: number) => void; // 모델 로딩 진행률
    device?: 'webgpu' | 'wasm';
    signal?: AbortSignal;
  }): Promise<void>;
  synth(text: string, opts?: {
    speed?: number;                    // length-scale (배속을 합성단에서 처리할 때)
    voice?: string;                    // 화자(모델 지원 시)
    signal?: AbortSignal;
  }): Promise<{ pcm: Float32Array; sampleRate: number }>;
  dispose(): void;
}
```

### 구현체
- **MUST** `transformersEngine` — `@huggingface/transformers`로 Supertonic/MMS. `device` 자동 선택(`navigator.gpu ? 'webgpu' : 'wasm'`).
- **SHOULD** `sherpaEngine` — sherpa-onnx-wasm. iOS/구형 또는 다른 모델용.
- **MUST** 합성은 **Web Worker**에서 실행(UI 블로킹 방지). 메인↔워커는 `postMessage`(transferable: PCM `ArrayBuffer`).

### 동작
1. 앱 시작 또는 첫 합성 시 `init()` → 모델 로딩(캐시 우선, FN-05).
2. `synth(chunk.text)` → `Float32Array` PCM 반환.
3. 빈 텍스트(무음 청크)는 `synth` 건너뛰고 `silenceMs` 길이의 무음 PCM 생성.

### 엣지케이스
| 상황 | 처리 |
|------|------|
| 모델 로딩 실패(네트워크) | 재시도 버튼 + 폴백 엔진 제안 |
| WebGPU init 실패 | 자동으로 `wasm` 폴백, 사용자에 안내 |
| 합성 중 취소(다른 문서로 전환) | `AbortSignal`로 중단, 진행 중 청크 폐기 |
| 영문/숫자/기호 혼재 | 모델 G2P에 위임. 심한 경우 FN-02에서 사전 정규화 |
| 합성 결과 비정상(길이 0) | 해당 청크 건너뛰고 로그 |

---

## FN-05 · 모델 캐싱 / 오프라인

### 동작
- **MUST** 모델 파일(가중치·토크나이저)을 **최초 1회 다운로드 → IndexedDB(store: `models`)에 raw 저장**.
- **MUST** 이후 실행은 네트워크 없이 IndexedDB에서 로드.
- **MUST** **앱 시작 시 모델 존재 검사** → 없으면(iOS 7일 만료 등) 재다운로드 플로우.
- **MUST** 다운로드 **진행률**(0~100%) 표시 + **취소** 가능.
- **SHOULD** transformers.js 자체 Cache API 캐싱과 충돌 없게: 직접 IDB 관리를 단일 소스로(또는 transformers.js 캐시에 위임하되 존재 검사 일원화).
- **SHOULD** 모델 용량·다운로드 상태를 설정 화면에 표시 + "모델 삭제(캐시 비우기)" 제공.

### 데이터
```typescript
interface CachedModel {
  modelId: string;       // 'supertonic'
  files: Record<string, ArrayBuffer>; // 파일명 → 바이트
  totalBytes: number;
  cachedAt: number;
}
```

### 엣지케이스
- 저장 쿼터 초과(QuotaExceededError) → 안내 + 기존 모델 삭제 유도.
- 다운로드 중 오프라인 전환 → 중단·재개(가능하면 Range), 불가 시 처음부터.
- 모델 파일 일부 손상 → 검증 실패 시 재다운로드.

---

## FN-06 · 연속 재생 (재생 엔진)

### 동작
- **MUST** 청크를 순서대로 합성·재생, **다음 청크를 미리 합성(프리페치 ≥1개)** → 끊김 방지.
- **MUST** 첫 청크 준비되면 **즉시 재생 시작**(전체 합성 대기 X).
- **MUST** 기기별 재생 경로 분기:
  - **PC/Android**: `WebAudioPlayer` — AudioBufferSourceNode 큐, `onended` 체이닝 또는 look-ahead 스케줄.
  - **iOS**: `AudioElementPlayer` — 합성 청크들을 **하나의 WAV Blob으로 이어붙여** `<audio src>` 재생(잠금화면 대응, FN-12·§리스크).
- **SHOULD** 재생 위치(globalTime)와 현재 청크 인덱스를 실시간 노출(FN-09·UI 진행바).

### 상태
```typescript
type PlaybackState = 'idle' | 'loading-model' | 'synthesizing'
                   | 'playing' | 'paused' | 'ended' | 'error';
interface PlayerStatus {
  state: PlaybackState;
  currentChunk: number;
  globalTimeSec: number;
  totalEstimatedSec?: number;
  bufferedChunks: number;
}
```

### 컨트롤 (FN-07과 연동)
- play / pause / 이전 문장 / 다음 문장 / seek(청크 단위 또는 시간) / 정지.

### 엣지케이스
- 합성이 재생을 못 따라감 → "버퍼링" 표시, 재생 일시 대기 후 재개.
- 마지막 청크 종료 → `ended`, 처음으로 또는 다음 문서(설정).
- 재생 중 새 문서 로드 → 현재 재생 정지·합성 취소 후 전환.
- iOS에서 사용자 제스처 없이 자동재생 시도 → 차단됨. 첫 재생은 반드시 탭/클릭 후.

---

## FN-07 · 재생 컨트롤 UI

- **MUST**: 재생/일시정지 토글, 이전/다음 문장, 진행바(드래그 seek), 현재 시간/총 시간(추정).
- **MUST**: 현재 읽는 문장을 화면에 **하이라이트 표시**(원문 동기화).
- **SHOULD**: 15초 뒤로/앞으로 점프.
- **SHOULD**: 키보드 단축키 — Space(재생/정지), ←/→(문장 이동), ↑/↓(배속), B(북마크).
- **MAY**: 흔들기/이어버드 제스처(웹 한계 내).

---

## FN-08 · 배속 조절

### 동작
- **MUST** 0.75 / 1.0 / 1.25 / 1.5 / 1.75 / 2.0x (또는 슬라이더). 기본 1.0.
- **MUST** **피치 보존**:
  - `<audio>` 경로(iOS): `audio.preservesPitch = true; audio.playbackRate = x`.
  - Web Audio 경로(PC/Android): **합성단 speed(length-scale) 조절**을 1차로(음질 무난), 또는 soundtouch/rubberband 워크릿(2차).
- **MUST** 배속 변경은 즉시 적용, 재생 위치 유지.
- **SHOULD** 마지막 배속 설정을 `settings`에 저장.

### 엣지케이스
- 합성단 speed 조절 시 이미 합성된 버퍼는 그대로 → 새 배속은 다음 청크부터(또는 재합성). UX상 즉시 반영 위해 `<audio>` preservesPitch를 PC에서도 우선 검토.
- 2.0x 초과 요구 → 상한 고정.

---

## FN-09 · 북마크 (타임스탬프 ↔ 원문 매핑) ★ 핵심

### 동작
- **MUST** 재생 중 북마크 버튼 → **현재 청크의 원문 위치**를 기록.
- **MUST** 매핑: `globalTime → upperBound(cumStart) → chunk → {sourceLineStart, sourceCharOffset}` (FN-03 prefix-sum).
- **MUST** 북마크 저장(IndexedDB `bookmarks`), 목록 조회, 삭제.
- **SHOULD** 북마크 시 짧은 햅틱/사운드/토스트 피드백.
- **SHOULD** 북마크에 미리보기 텍스트(해당 청크 앞 30자) 저장.

### 데이터
```typescript
interface Bookmark {
  id: string;
  documentId: string;
  chunkIndex: number;
  sourceLineStart: number;
  sourceCharOffset: number;
  previewText: string;
  globalTimeSec: number;
  createdAt: number;
  note?: string;   // Post-MVP
}
```

### 엣지케이스
- 같은 지점 중복 북마크 → 허용하되 목록에서 인접 표시(또는 토글 삭제).
- 문서 삭제 시 연결된 북마크도 삭제(cascade).
- 배속·seek 후에도 매핑 정확(globalTime 기준이므로 무관).

---

## FN-10 · 정독 뷰 (2단계)

### 동작
- **MUST** 원문(렌더된 마크다운 또는 평문)을 화면에 표시.
- **MUST** 북마크 클릭 → 해당 `sourceLine`으로 **자동 스크롤 + 하이라이트**.
- **MUST** 재생 중 현재 문장을 정독 뷰에서도 동기 하이라이트.
- **SHOULD** 정독 뷰의 임의 문장 클릭 → 그 지점부터 재생(역방향 연결).
- **SHOULD** 마크다운 렌더링(헤더·코드블록·표를 시각적으로) — 정독은 눈으로 보므로 원문 서식 유지가 유리.

### 엣지케이스
- 매우 긴 문서 → 가상 스크롤 고려(성능).
- 정제로 사라진 요소(코드블록)도 정독 뷰엔 보여야 함 → 정독은 **원문 렌더**, 청취는 **정제본** (두 표현 분리).

---

## FN-11 · 문서 라이브러리

### 동작
- **MUST** 업로드한 문서 목록(제목·날짜·길이·북마크 수) 표시.
- **MUST** 문서 선택 → 재생/정독, 삭제.
- **SHOULD** 검색/정렬(최근순·제목순).
- **SHOULD** 마지막 재생 위치 저장 → 이어듣기.

### 데이터
```typescript
interface StoredDocument {
  id: string;
  title: string;
  rawText: string;
  cleanBlocks?: CleanBlock[];  // 캐시(재정제 생략)
  chunks?: Chunk[];
  lastPositionSec?: number;
  createdAt: number;
  updatedAt: number;
}
```

---

## FN-12 · PWA / 모바일

### 동작
- **MUST** `manifest.webmanifest`: name, short_name, icons(192/512/maskable), `display:"standalone"`, start_url, theme/background color.
- **MUST** Service Worker(vite-plugin-pwa): 앱셸(HTML/JS/CSS) 오프라인 캐싱. **모델은 SW 아닌 IndexedDB**(FN-05).
- **MUST** `MediaSession`: metadata(문서명/현재 문장) + actionHandler(play/pause/previoustrack/nexttrack/seekforward/seekbackward) → 잠금화면·OS 미디어 패널.
- **SHOULD** iOS "홈 화면에 추가" 안내 UI(자동 프롬프트 없음).
- **SHOULD** 다크모드, 반응형(모바일 우선).

### iOS 특수 처리 (§리스크 반영)
- **MUST** iOS 감지 시 `AudioElementPlayer`(이어붙인 WAV) 경로 사용.
- **MUST** 자동재생 차단 → 첫 재생은 사용자 제스처로.
- **SHOULD** 백그라운드 재생 한계를 설정/안내에 명시(잠금 후 일정 시간 뒤 멈출 수 있음).

---

## 데이터 저장소 요약 (IndexedDB)

| Store | 키 | 내용 |
|-------|----|------|
| `documents` | id | 원문·정제본·청크·마지막 위치 |
| `bookmarks` | id | 북마크(문서별) |
| `models` | modelId | 모델 바이트 캐시 |
| `settings` | 'global' | 배속·정제 옵션·테마·엔진 선택 |

---

## 화면 구성 (정보 구조)

```
┌─ 홈 / 라이브러리 ─────────────┐
│  + 문서 추가(업로드/붙여넣기)   │
│  [문서 카드 목록] 제목·날짜·북마크수 │
└──────────────────────────────┘
        │ 문서 선택
        ▼
┌─ 플레이어 ────────────────────┐
│  문서 제목 / 진행바 / 시간       │
│  [현재 문장 하이라이트 텍스트]    │
│  ◀◀  ▶/⏸  ▶▶   배속  🔖북마크   │
│  탭: [청취] [정독] [북마크 목록]  │
└──────────────────────────────┘
        │ 북마크 클릭
        ▼
┌─ 정독 뷰 ─────────────────────┐
│  마크다운 렌더 원문             │
│  (북마크/현재문장 하이라이트·점프) │
└──────────────────────────────┘
설정: 엔진/모델, 정제 옵션, 캐시 관리, 테마
```

---

## 비고
- 모든 신규 데이터는 로컬(IndexedDB)에만 저장 — 서버 전송 없음.
- 엔진/플레이어는 인터페이스로 분리해 단위 테스트·교체 용이.
- 상세 구현 순서·검증은 [04-checklist.md](04-checklist.md).
