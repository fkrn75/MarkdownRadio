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
   │  위치 상태 = currentIndex 기반(시간 ms 상태 아님)
   ▼
[RadioEngine] ─ 얇은 façade (재생 도메인 추상화 X)
   │  load(chunks)/play/pause/stop/seekToChunk(i)
   │  position{chunkIndex,charOffset}, on('chunkChange'|'end')
   ▼
[TTS 어댑터] (엔진은 어댑터 뒤에 격리)
   ├─ Supertonic 어댑터 ← 제품 정체성(온디바이스, WebGPU·WASM)
   └─ Web Speech 어댑터 ← 부트스트랩 폴백(무모델 즉시 동작)
   │  (Supertonic 도입 시) 합성은 Web Worker, 모델 로딩 ← [IndexedDB modelCache]
   ▼
[AudioPlayer]
   ├─ WebAudioPlayer (PC/Android, 청크 큐·gapless)
   └─ AudioElementPlayer (iOS, 이어붙인 WAV Blob)
[저장] IndexedDB: documents / bookmarks / settings / models
       + localStorage: events(계측 ring buffer)
[PWA] Service Worker(앱셸) + manifest + MediaSession
```

> 부트스트랩 폴백 주: Supertonic 모델 로딩 전/실패 시 브라우저 내장 `speechSynthesis`(Web Speech)로 즉시 동작을 보장하되, 제품 정체성은 온디바이스 Supertonic이다.

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

마크다운을 TTS가 자연스럽게 읽을 **평문**으로 변환하되, **원문 문자 오프셋을 절대 잃지 않는다**.

- **MUST** **remark(mdast)로 파싱 후 각 노드의 `node.position.start.offset` / `node.position.end.offset` 기반으로 원문을 `slice`**해 평문을 만든다. `mdast-util-to-string`처럼 **오프셋을 잃는 변환 함수는 금지**(원문↔재생↔북마크 매핑이 깨진다).
- **MUST** 문장 분리는 **`Intl.Segmenter('ko', { granularity: 'sentence' })`** 로 수행(약어·소수점 보호의 1차 수단).

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
- **MUST** 문장 경계로 분할(`Intl.Segmenter('ko','sentence')`, FN-02), 단 `예: 3.14`, `Dr.`, 약어 보호.
- **MUST** 한 청크가 너무 길면(> 설정값, 기본 **200자**) 쉼표/접속사/공백에서 강제 분할 → 합성 지연·메모리 관리. **사유**: 합성 지연/메모리 + **Chrome `speechSynthesis` 15초 침묵 버그(긴 발화 중단) 회피**.
- **MUST** 너무 짧은 청크(< 10자)는 다음 청크와 병합(과도한 끊김 방지). 단 헤더는 단독 유지 가능.
- **MUST** 각 청크에 원문 위치 메타(`startOffset`/`endOffset`) 부여(FN-09 북마크용).
- **SHOULD** 헤더 블록 다음에 **무음 청크**(1.5~2초) 삽입 옵션 → 라디오 코너 전환 연출.

### 데이터
```typescript
interface Chunk {
  index: number;            // 0-based 순번
  text: string;             // 합성할 평문 (무음 청크는 "")
  startOffset: number;      // 원문 문자 오프셋(시작, 0-based)
  endOffset: number;        // 원문 문자 오프셋(끝, exclusive)
  kind: 'speech' | 'silence';
  silenceMs?: number;       // kind==='silence'일 때
  // 합성 후(audioBuffer 경로에서만) 채워짐:
  durationSec?: number;
  audioRef?: string;        // 메모리/캐시 참조
}
```

### 불변식 (MUST · 강제)
- `chunk.text === sourceText.slice(chunk.startOffset, chunk.endOffset)` (공백·줄바꿈 정규화는 감안하되, 오프셋 쌍은 항상 원문의 실제 범위를 가리켜야 한다).
- 이 불변식을 **빌드타임 + 런타임 양쪽에서 `assert`로 강제**한다(매핑이 깨지면 즉시 실패시켜 북마크/하이라이트 오정렬을 사전 차단). `kind==='silence'`(무음)는 `text===''`이므로 검사 대상에서 제외.

### 파생: prefix-sum (audioBuffer 경로 후순위 전용)
- **audioBuffer 경로(후순위)에서만**: 합성으로 `durationSec`가 정해지면 `cumStart[i] = Σ duration[0..i-1]` 계산 → 시간↔청크 역산. 기본(Web Speech / 정체성 Supertonic 재생단) 위치 추적은 시간이 아니라 **currentIndex(chunkIndex)** 기반이다.

---

## FN-04 · 재생 엔진 RadioEngine (얇은 façade) ★ 핵심

UI는 **`RadioEngine`이라는 얇은 façade 하나**만 본다. 넓은 도메인 추상화를 하지 않고, "청크 목록을 라디오처럼 재생"하는 최소 표면만 노출한다. 실제 TTS 백엔드(`speechSynthesis` 등)는 **어댑터 뒤에 격리**되어 façade 내부에서만 다뤄진다.

### 인터페이스
```typescript
interface RadioEngine {
  load(chunks: Chunk[]): Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  seekToChunk(i: number): void;          // 모든 점프의 단일 진입점
  readonly position: { chunkIndex: number; charOffset: number };
  on(event: 'chunkChange' | 'end', cb: (p: RadioEngine['position']) => void): void;
  // 백엔드가 제공할 때만 채워지는 선택 능력
  readonly capabilities: {
    wordBoundary?: boolean;   // onboundary 이벤트로 단어 단위 charOffset 갱신 가능
    audioBuffer?: boolean;    // PCM/AudioBuffer 경로(시간 기반 seek·length-scale) 가능
  };
}
```

### 어댑터 (façade 내부, UI 비노출)
- **정체성 엔진 = Supertonic 어댑터** — 온디바이스 합성(WebGPU·WASM). 합성은 **Web Worker**에서 실행(UI 블로킹 방지), 메인↔워커는 `postMessage`(transferable: PCM `ArrayBuffer`). 모델 로딩은 캐시 우선(FN-05).
- **부트스트랩 폴백 = Web Speech 어댑터** — 브라우저 내장 `speechSynthesis`. 무모델로 즉시 동작, Supertonic 로딩 전/실패 시 사용.
- 규칙(MUST):
  - `speechSynthesis`는 **반드시 어댑터 뒤에 격리**(façade 시그니처에 브라우저 API 노출 금지).
  - **모든 점프(`seekToChunk`)는 `speechSynthesis.cancel()` 선행** 후 대상 청크부터 재발화 → 안드로이드/크롬 큐 잔류 버그 회피.
  - `pause/resume`이 불안정한 환경에서는 **현재 청크 cancel 후 재발화(re-speak)** 폴백으로 처리.

### 동작
1. `load(chunks)` → 백엔드 준비(Supertonic은 모델 로딩, Web Speech는 즉시).
2. 청크 순서대로 발화/재생, 청크 전환 시 `chunkChange`로 `position` 갱신.
3. 빈 텍스트(무음 청크)는 발화 없이 `silenceMs`만큼 대기 후 다음 청크.

### 엣지케이스
| 상황 | 처리 |
|------|------|
| Supertonic 모델 로딩 실패(네트워크) | 재시도 버튼 + Web Speech 부트스트랩으로 계속 |
| WebGPU init 실패 | 자동으로 `wasm` 폴백, 사용자에 안내 |
| 합성/발화 중 취소(다른 문서로 전환) | `cancel()`(+ Supertonic은 `AbortSignal`)로 중단, 진행 중 청크 폐기 |
| 영문/숫자/기호 혼재 | 백엔드 G2P에 위임. 심한 경우 FN-02에서 사전 정규화 |
| 합성 결과 비정상(길이 0) | 해당 청크 건너뛰고 로그 |

---

## FN-05 · 모델 캐싱 / 오프라인 (온디바이스 Supertonic 도입 시 · 후순위)

> 적용 시점: 부트스트랩(Web Speech)은 모델이 없으므로 본 절은 **정체성 엔진 Supertonic을 온디바이스로 도입하는 단계(후순위)** 에서 활성화된다.

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
  - **iOS**: `AudioElementPlayer` — 합성 청크들을 **하나의 WAV Blob으로 이어붙여** `<audio src>` 재생(잠금화면 대응, FN-12·§리스크). (audioBuffer 경로 도입 시)
- **SHOULD** 현재 청크 인덱스(`currentIndex`)를 진행 단위로 실시간 노출(FN-09·UI 진행바). 시간(초)은 audioBuffer 경로에서만 보조 표시.

### 상태
```typescript
type PlaybackState = 'idle' | 'loading-model' | 'synthesizing'
                   | 'playing' | 'paused' | 'ended' | 'error';
interface PlayerStatus {
  state: PlaybackState;
  currentChunk: number;          // 위치의 단일 진실(SSOT)
  totalChunks: number;
  bufferedChunks: number;
  // audioBuffer 경로(후순위)에서만:
  globalTimeSec?: number;
  totalEstimatedSec?: number;
}
```

### 컨트롤 (FN-07과 연동)
- play / pause / 이전 문장 / 다음 문장 / `seekToChunk`(청크 단위) / 정지. 시간 기반 seek은 audioBuffer 경로(후순위)에서만.

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
- **MUST** 배속은 **재생단에서 통일**해 적용(피치 보존):
  - Web Speech 경로: `utterance.rate = x` (브라우저가 피치 보존).
  - audioBuffer 경로(후순위): `audio.preservesPitch = true; audio.playbackRate = x`.
  - **합성단 length-scale 조절은 audioBuffer 경로(후순위)에서만** 고려(기본 경로는 합성단을 건드리지 않는다).
- **MUST** 배속 변경은 즉시 적용, 재생 위치(현재 청크) 유지.
- **SHOULD** 마지막 배속 설정을 `settings`에 저장.

### 엣지케이스
- 재생단 통일이므로 이미 준비된 청크도 새 배속이 즉시 반영(재합성 불필요). 합성단 length-scale을 쓰는 audioBuffer 경로에서만 "새 배속은 다음 청크부터" 제약이 생긴다.
- 2.0x 초과 요구 → 상한 고정.

---

## FN-09 · 북마크 (청크 ↔ 원문 매핑) ★ 핵심

### 동작
- **MUST** 재생 중 북마크 버튼 → **현재 위치 `{chunkIndex, charOffset}`** 를 기록(엔진 `position` 그대로).
- **MUST** 원문 위치는 `chunk.startOffset`(+ `charOffset`)에서 **직접** 얻는다(별도 매핑 테이블·시간 역산 불필요).
- **MUST** **재생 ms(시간)를 북마크 상태로 저장 금지** — 엔진/배속/백엔드가 바뀌면 깨진다. 위치의 진실은 청크 인덱스다.
- **MUST** 북마크 저장(IndexedDB `bookmarks`), 목록 조회, 삭제.
- **SHOULD** 북마크 시 짧은 햅틱/사운드/토스트 피드백.
- **SHOULD** 북마크에 미리보기 텍스트(해당 청크 앞 30자) 저장.

### 데이터
```typescript
interface Bookmark {
  id: string;
  documentId: string;
  chunkIndex: number;   // 위치의 진실
  charOffset: number;   // 청크 내 상대 오프셋(원문 위치 = chunk.startOffset + charOffset)
  previewText: string;
  createdAt: number;
  note?: string;   // Post-MVP
}
```

### 엣지케이스
- 같은 지점 중복 북마크 → 허용하되 목록에서 인접 표시(또는 토글 삭제).
- 문서 삭제 시 연결된 북마크도 삭제(cascade).
- 배속·seek 후에도 매핑 정확(`chunkIndex` 기준이므로 시간·배속과 무관).

---

## FN-10 · 정독 뷰 (2단계)

### 동작
- **MUST** 원문(렌더된 마크다운 또는 평문)을 화면에 표시.
- **MUST** 북마크 클릭 → `chunk.startOffset + charOffset`로 원문 위치를 계산해 **자동 스크롤 + 하이라이트**.
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

## FN-13 · 계측 (Instrumentation) ★ 핵심 지표 SSOT

"흘려듣기 후 실제로 돌아와 정독하는가"(복귀율)를 측정하기 위한 **로컬 계측**. 본 절이 이벤트·지표 **정의의 단일 출처(SSOT)** 이며, 다른 문서·코드는 이를 참조한다. **서버 전송 없음**(모든 이벤트는 로컬에만 저장).

### 이벤트 8종
| 이벤트 | 발생 시점 | 비고 |
|--------|-----------|------|
| `doc_open` | 문서 열림 | 세션 시작 후보 |
| `chunk_play_start` | 청크 발화/재생 시작 | `chunkIndex` 필수 |
| `chunk_play_end` | 청크 발화/재생 종료 | `chunkIndex` 필수 |
| `bookmark_add` | 북마크 추가 | `chunkIndex` 필수 |
| `bookmark_click` | 북마크 목록에서 점프 | `chunkIndex` 필수 |
| `jump_resolved` | 점프가 대상 청크에 안착 | `seekToChunk` 완료 |
| `manual_seek` | 사용자가 진행바/이전·다음으로 이동 | **패시브 계측만**(점수화 금지) |
| `read_scroll` | 정독 뷰 스크롤 | **패시브 계측만**(점수화 금지) |

> `manual_seek` · `read_scroll`은 행동 관찰용으로만 적재하며, 복귀율/품질 점수 계산식에 가중치로 넣지 않는다(노이즈·자기충족 예방).

### 공통 envelope
```typescript
interface InstrumentationEvent {
  type: EventType;          // 위 8종
  ts: number;               // epoch ms
  sessionId: string;        // 세션 식별(아래 절단 규칙)
  docId: string;
  docHash: string;          // 원문 해시(같은 문서 재오픈 식별)
  chunkIndex?: number;      // 청크 관련 이벤트에서
  visible: boolean;         // 발생 시 document.visibilityState === 'visible'
}
```

### 세션 절단
- **MUST** 마지막 이벤트로부터 **gap > 30분**이면 새 `sessionId`로 절단(흘려듣기/정독을 별 세션으로 구분).

### 저장
- **MUST** `localStorage`에 **ring buffer**(상한 도달 시 오래된 이벤트부터 폐기)로 적재 — IndexedDB 부담 없이 경량 보관.
- **MUST** 서버 전송 없음. 외부로 나가지 않는다.

### 복귀율 지표 (정량 + 정성)
- **정량(주 지표)**: `복귀율 = (bookmark_add가 있던 세션 중, 이후 같은 docHash에서 bookmark_click 또는 해당 청크 근방 read_scroll로 돌아온 세션 수) / (bookmark_add가 있던 세션 수)`.
- **보조 정량**: 북마크당 평균 복귀 횟수, 첫 북마크→첫 복귀까지의 경과(세션 수).
- **정성**: 복귀 후 정독 뷰 체류(연속 `read_scroll` 지속), 같은 청크 반복 청취 여부 등 패턴 관찰(점수화 아님).

---

## 데이터 저장소 요약 (IndexedDB)

| Store | 키 | 내용 |
|-------|----|------|
| `documents` | id | 원문·정제본·청크·마지막 위치 |
| `bookmarks` | id | 북마크(문서별, `{chunkIndex, charOffset}`) |
| `models` | modelId | 모델 바이트 캐시 — **온디바이스 Supertonic 도입 시(후순위, FN-05)** |
| `settings` | 'global' | 배속·정제 옵션·테마·엔진 선택 |

> 계측 이벤트(FN-13)는 IndexedDB가 아닌 **localStorage `events`(ring buffer)** 에 저장한다.

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
