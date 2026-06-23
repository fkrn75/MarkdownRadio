# 04 · 구현 체크리스트 (Detailed Checklist)

> Markdown Radio v1.0 · 2026-06-21
> Phase 0~10. 각 항목은 독립적으로 체크 가능하도록 세분화. `[ ]`→진행 전, `[x]`→완료.
> 우선순위: **P0**=MVP 필수, **P1**=MVP 권장, **P2**=Post-MVP.
> 기능 참조: [03-functional-spec.md](03-functional-spec.md) / 근거: [01-research.md](01-research.md)

> 🔴 **5라운드 적대검증 합의(redline) 반영판.** 제품 정체성=온디바이스 Supertonic 유지. 단 **MVP는 축소**하고 **iOS·온디바이스 모델 캐싱·백그라운드 재생·PWA는 P0에서 제외→후순위**로 재배치한다(첫 스프린트 완주 최대 리스크). 첫 스프린트 핵심은 **폐루프**(붙여넣기→정제→청크→연속재생→북마크→원문 정독 점프+하이라이트). **정제+문장청크가 80% 승부.**

---

## Phase 0 · 사전 검증 (코드 짜기 전 — 핵심만 압축)

> 🔴 **비차단 병행 트랙.** Supertonic PoC는 **가치 검증(폐루프)을 막지 않는다.** Phase 0과 첫 스프린트(MVP)는 병행 진행하되, PoC 게이트 불합격 시 모델만 폴백으로 교체한다(제품 방향·폐루프는 그대로). PoC가 끝날 때까지 첫 스프린트를 멈추지 말 것.

### 0.1 Supertonic 실청취 (데모) (P0)
- [ ] [Supertonic WebGPU 데모](https://huggingface.co/spaces/webml-community/Supertonic-TTS-WebGPU)에 **실제 청취할 한국어 마크다운** 붙여넣고 듣기
- [ ] 코드/영문 용어 섞인 문단 발음 확인 (예: "이 함수는 async/await로 처리한다")
- [ ] 긴 문장·숫자·날짜·단위 발음 확인
- [ ] **실청취 A/B 판정 기록**: 흘려듣기 필터링용으로 합격? (Y → Supertonic 확정 / N → 폴백 평가)

### 0.2 한 문장 합성 PoC (P0)
- [ ] 빈 Vite 프로젝트에서 `@huggingface/transformers`로 Supertonic 로드 → **한 문장 합성·재생** 성공
- [ ] WebGPU 동작 확인 + WASM 폴백 동작 확인

### 0.3 offset 검증 (P0)
- [ ] **`chunk.text === 원문.slice(charOffset, charOffset+len)` 불변식 성립 확인** (정제→청크 후에도 원문 위치 역추적 가능한지 PoC)

### 0.4 PoC 게이트 5종 (P0 · 비차단)
- [ ] **콜드스타트**: 첫 로딩(모델 다운로드+초기화) 시간 실측 (PC + 폰)
- [ ] **RTF steps별**: length-scale/steps **5·8·12** 각각 합성 1문장 RTF 실측 → 품질↔속도 트레이드오프 기록
- [ ] **백그라운드 생존**: 탭 백그라운드/화면 잠금 시 합성·재생 지속 여부 확인
- [ ] **실파일 크기**: 모델 다운로드 용량 실측 기록
- [ ] **실청취 A/B**: 0.1 결과로 흘려듣기 합격 판정 (게이트 통과 여부)

### 0.5 라이선스 확인 (P0)
- [ ] Supertonic 모델 **OpenRAIL-M use-restriction 조항** 읽기 (수익화 계획 시)
- [ ] 개인/포트폴리오 용도면 문제없음 확인
- [ ] 완전 자유 필요 시 MeloTTS(MIT) 채택 여부 결정

### 0.6 폴백 평가 (합격 시 생략 가능)
- [ ] MeloTTS-Korean 샘플 청취 (HF 모델카드)
- [ ] MMS-tts-kor 데모로 "최저 품질" 기준선 확인
- [ ] 폴백 우선순위 결정 기록

---

## 첫 스프린트 (MVP) · 폐루프 = P0 핵심

> 🔴 **이 스프린트의 정의 = 폐루프 한 줄기를 PC Chrome에서 완주.**
> 붙여넣기 → **정제** → **문장 청크** → 연속 재생 → 북마크 → 원문 정독 점프 + 하이라이트.
> **차단 요소 금지**: iOS 경로·온디바이스 모델 캐싱·백그라운드 재생·PWA·MediaSession·배속은 **이 스프린트에서 제외**(아래 후순위 Phase에서 처리). 첫 스프린트는 PC Chrome(WebGPU/WASM) 단일 타깃.
> **80% 승부 = 정제 + 문장청크.** 가장 먼저, 가장 공들일 항목.

### MVP-1 입력 (P0)
- [ ] 텍스트 **붙여넣기** 입력 (드래그앤드롭/파일업로드는 선택, 붙여넣기 우선)
- [ ] `.md`/`.txt` 텍스트 받기 + 문서명 자동 추출(첫 헤더/첫 줄)

### MVP-2 정제 (P0 · 최우선·최대 공수) FN-02
- [ ] 🔴 **정제는 폐루프의 80% 승부 — 가장 먼저, 가장 공들여 구현**
- [ ] 헤더 → 텍스트 + `isHeading` 플래그
- [ ] 강조(`**`,`*`,`~~`) 마커 제거, 인라인 코드 처리
- [ ] 코드블록 **건너뛰기**(기본), 표 건너뛰기(기본)
- [ ] 링크 → 텍스트만(URL 제거), 이미지 제거
- [ ] 연속 공백·빈 줄 정규화
- [ ] **원문 위치(charOffset) 보존** — offset 불변식의 출발점
- [ ] **정제 테스트 케이스 작성**(요소별 입력→기대 출력)

### MVP-3 문장 청크 (P0 · 최우선) FN-03
- [ ] 🔴 **청크도 80% 승부의 절반 — 정제와 함께 최우선**
- [ ] 문장 경계 분할(종결부호 + 약어/소수점 보호)
- [ ] 긴 청크 강제 분할(기본 200자) + 짧은 청크 병합
- [ ] **청크별 원문 위치 메타(`chunkIndex` + `charOffset`)** — ms 절대 금지
- [ ] 청크 분할 테스트 케이스

### MVP-4 연속 재생 (P0) FN-06
- [ ] 첫 청크 준비되면 즉시 재생 시작
- [ ] 다음 청크 **프리페치**(≥1) + AudioBuffer 큐(gapless)
- [ ] 합성이 재생 못 따라갈 때 버퍼링 처리
- [ ] 재생 상태/위치/현재청크 실시간 노출(store)

### MVP-5 북마크 (P0) FN-09
- [ ] 🔴 **`chunkIndex` + `charOffset` 기반으로 위치 기록 — ms 금지**
- [ ] 🔴 **offset 불변식 `assert(chunk.text === 원문.slice(charOffset, …))`를 코드에 박아 회귀 방지** (체크 항목)
- [ ] 북마크 버튼 → 현재 위치 기록(IndexedDB `bookmarks`)
- [ ] previewText(앞 30자) 저장 + 목록 조회·삭제

### MVP-6 원문 정독 점프 + 하이라이트 (P0) FN-10
- [ ] 원문 마크다운 렌더
- [ ] 북마크/현재 위치 클릭 → **정독 뷰 스크롤 + 하이라이트**
- [ ] 재생 중 현재 문장 동기 하이라이트(원문 동기)

### MVP-7 계측 / 복귀율 로깅 (P0)
- [ ] 🔴 **복귀율 측정용 이벤트 로깅(localStorage)** — [FN-13 · 계측](03-functional-spec.md) 참조
- [ ] 정량 이벤트: 세션 시작/문서 열기/재생 시작·종료·재방문 일시 기록
- [ ] 정성 메모 슬롯: "왜 다시 안 듣게 됐나" 자유 기록(도그푸딩용)
- [ ] 🔴 **복귀율 게이트는 런칭 후 실험 게이트**(정량+정성) — MVP 차단 조건 아님, 데이터만 먼저 쌓기

---

## Phase 1 · 프로젝트 셋업

### 1.1 스캐폴딩 (P0)
- [ ] `npm create vite@latest` → Svelte + TypeScript 템플릿
- [ ] 폴더 구조 생성 (spec §0 아키텍처 기준):
  - [ ] `src/lib/tts/engine.ts` (인터페이스)
  - [ ] `src/lib/tts/transformersEngine.ts`
  - [ ] `src/lib/tts/sherpaEngine.ts` (P1)
  - [ ] `src/lib/tts/worker.ts`
  - [ ] `src/lib/audio/webAudioPlayer.ts`
  - [ ] `src/lib/audio/audioElementPlayer.ts` (후순위 — iOS 경로)
  - [ ] `src/lib/storage/db.ts` (IndexedDB 래퍼)
  - [ ] `src/lib/storage/modelCache.ts` (후순위 — 온디바이스 캐싱)
  - [ ] `src/lib/text/clean.ts` (마크다운 정제)
  - [ ] `src/lib/text/chunk.ts` (청크 분할)
  - [ ] `src/lib/bookmark.ts`
  - [ ] `src/lib/stores/` (Svelte stores)
  - [ ] `src/routes/` 또는 컴포넌트
- [ ] ESLint + Prettier + TypeScript strict 설정
- [ ] Git 초기화 + `.gitignore`(node_modules, dist, 모델 파일)
- [ ] GitHub 리포 생성 (커밋 아이덴티티: fkrn75@gmail.com — git-commit-identity 메모 참조)

### 1.2 의존성 (P0)
- [ ] `@huggingface/transformers` 설치
- [ ] `markdown-to-txt` 또는 정제용 파서(`marked`/`remark`) 설치
- [ ] `idb`(IndexedDB 래퍼, 선택) 설치
- [ ] (후순위) `vite-plugin-pwa` 설치 — PWA 단계에서
- [ ] (P1) sherpa-onnx-wasm 패키지/에셋 확보

### 1.3 기본 레이아웃 (P0)
- [ ] 라우팅/뷰 골격: 라이브러리 / 플레이어 / 정독 / 설정
- [ ] 다크모드 + 반응형(모바일 우선) 기본 CSS
- [ ] 한국어 폰트(Pretendard 등) + `word-break:keep-all`

---

## Phase 2 · 텍스트 파이프라인

> 🔴 첫 스프린트(MVP-2/3)에서 **정제+청크 핵심을 이미 구현**한다. 이 Phase는 나머지 마크다운 요소·엣지케이스를 완성하는 단계.

### 2.1 문서 입력 FN-01 (P0)
- [ ] 파일 업로드(드래그앤드롭 + 버튼), `.md`/`.txt` 필터
- [ ] `FileReader` UTF-8 디코딩
- [ ] 텍스트 붙여넣기 입력 (MVP에서 완료)
- [ ] 문서명 자동 추출(파일명/첫 헤더/첫 줄)
- [ ] 빈 입력·대용량·비지원 형식 엣지케이스 처리
- [ ] 업로드 즉시 IndexedDB `documents` 저장

### 2.2 마크다운 정제 FN-02 (P0)
- [ ] 헤더 → 텍스트 + `isHeading` 플래그 (MVP에서 완료)
- [ ] 강조(`**`,`*`,`~~`) 마커 제거 (MVP에서 완료)
- [ ] 코드블록 **건너뛰기**(기본) + 토글
- [ ] 인라인 코드 처리
- [ ] 링크 → 텍스트만, URL 제거
- [ ] 이미지 제거(또는 alt)
- [ ] 표 건너뛰기(기본) + 셀 나열 토글
- [ ] 리스트/인용/구분선/각주/HTML/이모지 처리
- [ ] 원문 URL → "링크" 치환
- [ ] 연속 공백·빈 줄 정규화 (MVP에서 완료)
- [ ] **원문 행 범위(sourceLineStart/End) 보존**
- [ ] 닫히지 않은 코드블록 휴리스틱
- [ ] **정제 테스트 케이스 작성**(요소별 입력→기대 출력)

### 2.3 청크 분할 FN-03 (P0)
- [ ] 문장 경계 분할(종결부호 + 약어/소수점 보호) (MVP에서 완료)
- [ ] 긴 청크 강제 분할(기본 200자) (MVP에서 완료)
- [ ] 짧은 청크 병합
- [ ] 청크별 원문 위치 메타(`chunkIndex`/`charOffset`) — **ms 금지** (MVP에서 완료)
- [ ] (P1) 헤더 뒤 무음 청크 삽입 옵션
- [ ] 청크 분할 테스트 케이스

---

## Phase 3 · TTS 엔진

### 3.1 엔진 추상화 FN-04 (P0)
- [ ] `TTSEngine` 인터페이스 정의(spec 그대로)
- [ ] `transformersEngine` 구현(Supertonic)
  - [ ] `init()` + 진행률 콜백 + device 자동선택
  - [ ] `synth()` → Float32 PCM
  - [ ] `dispose()`
- [ ] WebGPU init 실패 → WASM 자동 폴백
- [ ] (P1) `mmsEngine` 또는 동일 엔진에 모델 스위치(프로토타입용)
- [ ] (P1) `sherpaEngine` 구현

### 3.2 Web Worker (P0)
- [ ] `worker.ts`: 합성 전담, `postMessage`로 PCM 전송(transferable)
- [ ] 메인↔워커 메시지 프로토콜 정의(synth 요청/응답/진행/에러)
- [ ] AbortSignal로 합성 취소 전파
- [ ] 무음 청크는 합성 건너뛰고 무음 PCM 생성

### 3.3 첫 합성·재생 (P0)
- [ ] "한 문장이 소리난다" — M2 마일스톤 달성
- [ ] 합성 실패·취소 엣지케이스

---

## Phase 4 · 모델 캐싱 (🔴 후순위 — P0에서 제외)

> 🔴 **온디바이스 모델 캐싱은 첫 스프린트 차단 요소 금지.** MVP는 매 세션 모델 로드(또는 transformers.js 기본 캐시)로 충분. IDB 영속 캐싱·iOS 7일 만료 대응은 폐루프 검증 이후 이 단계에서 처리.

### 4.1 IndexedDB 캐시 FN-05 (후순위)
- [ ] `models` store + raw ArrayBuffer 저장
- [ ] 최초 다운로드 → IDB 저장 로직
- [ ] 2회차 IDB 로드(네트워크 없이)
- [ ] **앱 시작 시 모델 존재 검사 → 없으면 재다운로드**(iOS 7일 만료 대응)
- [ ] 다운로드 **진행률 UI** + **취소**
- [ ] transformers.js Cache API와 단일 소스로 일원화(중복 다운로드 방지)

### 4.2 캐시 관리 (P1)
- [ ] 설정 화면: 모델 용량·상태 표시
- [ ] "모델 삭제(캐시 비우기)" 버튼
- [ ] QuotaExceeded·손상·중단 엣지케이스

---

## Phase 5 · 연속 재생

> 🔴 PC/Android Web Audio 연속 재생은 첫 스프린트(MVP-4)에서 핵심 구현. 이 Phase는 컨트롤 완성 + **iOS 경로(후순위)** 처리.

### 5.1 재생 엔진 FN-06 (P0)
- [ ] `WebAudioPlayer`(PC/Android): AudioBuffer 큐 + gapless (MVP에서 핵심 완료)
- [ ] 다음 청크 **프리페치**(≥1) 파이프라인 (MVP에서 완료)
- [ ] 첫 청크 준비되면 즉시 재생 시작 (MVP에서 완료)
- [ ] 합성이 재생 못 따라갈 때 버퍼링 처리
- [ ] 재생 상태/위치/현재청크 실시간 노출(store)
- [ ] 마지막 청크 종료 처리(ended)
- [ ] 문서 전환 시 정지·합성 취소

### 5.2 iOS 재생 경로 FN-06/12 (🔴 후순위 — P0에서 제외)
- [ ] iOS 감지
- [ ] `AudioElementPlayer`: 청크 PCM → **WAV Blob 이어붙이기** → `<audio src>`
- [ ] 자동재생 차단 대응(첫 재생 제스처)
- [ ] (실기기) 잠금화면 동작 확인

### 5.3 재생 컨트롤 FN-07 (P0)
- [ ] play/pause 토글
- [ ] 이전/다음 문장
- [ ] 진행바 + seek(드래그)
- [ ] 현재 시간/총 시간(추정)
- [ ] 현재 문장 하이라이트(원문 동기)
- [ ] (P1) 15초 점프, 키보드 단축키(Space/←→/↑↓/B)

### 5.4 재생목록 · 반복 FN-14/15/16 (P1)
- [x] **재생목록(순차 재생)** — 라이브러리 체크박스 다중선택 → "N개 재생목록 재생", 문서 끝나면 다음 자동 로드+재생, "재생목록 i/total" 표시 (App `playQueue`/`queueIndex`)
- [x] **한 문서 반복(🔁)** — 청취·정독 토글, 끝나면 `seekToChunk(0)` 재생 (`repeatMode='one'`)
- [x] **구간 반복(A-B, ↔)** — 청취=A→B→해제 1버튼 / 정독=텍스트 클릭으로 A·B 지정, `chunkChange`에서 끝 청크 넘으면 시작으로 복귀 (`repeatMode='ab'`, `abStart`/`abEnd`/`abPick`)
- [x] **재생목록 순서 변경(📋)** — `PlaylistQueue.svelte` 패널(▲▼ 순서변경·✕ 제거·클릭 점프), 현재 항목 추적(`queueIndex` 보정)으로 무중단, 현재 항목 제거 차단
- [x] 상태 App 집중 · 엔진(`seekToChunk`/`play`) 재사용·무수정 · offset 불변식 무수정 · 5파일(`PlaylistQueue` 신규 + `App`/`Library`/`Player`/`ReadingView`) · svelte-check 561/0/0·build·invariant OK

---

## Phase 6 · 배속 (P1 — MVP 제외)

> 🔴 배속은 폐루프 완주에 필수 아님 → 첫 스프린트 제외.

### 6.1 피치 보존 배속 FN-08 (P1)
- [ ] `<audio>` 경로: `preservesPitch=true` + `playbackRate`
- [ ] Web Audio 경로: 합성단 speed(length-scale) 조절 1차
- [ ] 배속 옵션 UI(0.75~2.0x)
- [ ] 배속 변경 즉시 적용·위치 유지
- [ ] 배속 설정 `settings` 저장
- [ ] (P1) 고품질 타임스트레치(soundtouch/rubberband) 검토

---

## Phase 7 · 북마크 & 정독

> 🔴 북마크/정독 폐루프 핵심은 첫 스프린트(MVP-5/6)에서 구현. 이 Phase는 매핑 정밀화 + 라이브러리.

### 7.1 위치 매핑 FN-09 (P0)
- [ ] 🔴 **매핑 단위 = `chunkIndex` + `charOffset` (ms 금지)**
- [ ] 🔴 **offset 불변식 assert** — `chunk.text === 원문.slice(charOffset, charOffset+len)` 코드에 박기
- [ ] 합성 후 `durationSec` → `cumStart` prefix-sum 계산 (재생 시간 표시·seek용, 위치 식별과 분리)
- [ ] `globalTime → 이진탐색 → chunk → 원문 위치` 역산
- [ ] 단일 audio 경로(currentTime) / 청크 경로 둘 다 정확

### 7.2 북마크 FN-09 (P0)
- [ ] 북마크 버튼 → 현재 위치(`chunkIndex`+`charOffset`) 기록(IndexedDB `bookmarks`) (MVP에서 완료)
- [ ] previewText(앞 30자) 저장
- [ ] 북마크 목록(문서별) 조회·삭제
- [ ] 피드백(토스트/햅틱)
- [ ] 문서 삭제 시 북마크 cascade 삭제
- [ ] 배속·seek 후 매핑 정확성 테스트(offset 불변식 회귀 포함)

### 7.3 정독 뷰 FN-10 (P0)
- [ ] 원문 **마크다운 렌더**(코드/표 시각 표시) (MVP에서 핵심 완료)
- [ ] 북마크 클릭 → 스크롤 + 하이라이트 (MVP에서 완료)
- [ ] 재생 중 현재 문장 동기 하이라이트 (MVP에서 완료)
- [x] 문장 **더블클릭** → 그 청크부터 재생(단클릭=위치 이동만 / 더블클릭=재생; 디바운스로 연속 seek 레이스 방지)
- [x] 정독 화면 **재생/일시정지 버튼**(청취와 동일, `playing` App 단일 소스)
- [ ] (P1) 긴 문서 가상 스크롤

### 7.4 라이브러리 FN-11 (P1)
- [ ] 문서 목록(제목/날짜/길이/북마크수)
- [ ] 선택·삭제
- [ ] 마지막 위치 이어듣기
- [ ] (P2) 검색/정렬

---

## Phase 8 · PWA & 모바일 (🔴 후순위 — P0에서 제외)

> 🔴 **PWA·MediaSession·모바일 마감은 첫 스프린트 차단 요소 금지.** 폐루프가 PC Chrome에서 완주된 뒤 진행. MVP는 일반 웹페이지로 충분.

### 8.1 PWA FN-12 (후순위)
- [ ] `manifest.webmanifest`(name/icons 192·512·maskable/standalone/start_url/theme)
- [ ] 아이콘 에셋 제작(192/512/maskable)
- [ ] vite-plugin-pwa(Workbox generateSW, autoUpdate)
- [ ] 앱셸 precache(**모델은 제외** — IDB가 담당)
- [ ] 오프라인 동작 확인(앱셸 + 캐시된 모델)

### 8.2 MediaSession (후순위)
- [ ] metadata(문서명/현재 문장/artwork)
- [ ] actionHandler: play/pause/previoustrack/nexttrack/seek
- [ ] 잠금화면·OS 미디어 패널 확인(Android)

### 8.3 모바일 마감 (P1)
- [ ] iOS "홈 화면에 추가" 안내 UI
- [ ] iOS 백그라운드 한계 안내 문구
- [ ] 반응형·다크모드 최종 점검

---

## Phase 9 · 배포

### 9.1 Cloudflare Pages (P0)
- [ ] `vite build` 정적 산출 확인
- [ ] Cloudflare Pages 연결(GitHub 자동 배포)
- [ ] (sherpa 멀티스레드 사용 시) `_headers`에 COOP/COEP 추가(SharedArrayBuffer)
- [ ] HTTPS·PWA 설치 가능 확인
- [ ] 커스텀 도메인(선택)

### 9.2 배포 후 검증 (P0)
- [ ] 폰에서 URL 접속 → 홈 화면 추가 → 실행
- [ ] 모델 다운로드(모바일 네트워크)·캐시 확인
- [ ] 실제 출퇴근 시나리오 도그푸딩

---

## Phase 10 · QA / 테스트 매트릭스

> 🔴 **첫 스프린트 QA = PC Chrome 위주.** iOS Safari·저사양폰은 후순위 단계로 이동(아래 10.5).

### 10.1 첫 스프린트 타깃 (P0)
- [ ] Chrome 데스크탑 (WebGPU) — **폐루프 완주 검증의 기준 환경**
- [ ] Edge / Firefox 데스크탑 (WASM 폴백 포함)
- [ ] Safari 데스크탑

### 10.2 기능 시나리오 (P0)
- [ ] 긴 문서(수천 자) 끊김 없는 연속 재생
- [ ] 코드블록·표·링크 많은 문서 정제 품질
- [ ] 영문/숫자/단위 혼재 발음
- [ ] 북마크 → 정독 점프 정확도(배속·seek 후 포함, offset 불변식 회귀)
- [ ] 재생 중 문서 전환·중단

### 10.3 엣지/내구성 (P1)
- [ ] 빈/깨진/거대 파일
- [ ] 저장 쿼터 초과
- [ ] 다운로드 중 네트워크 끊김
- [ ] 1시간+ 장시간 청취 메모리 누수 점검

### 10.4 접근성 (P1)
- [ ] 키보드 전용 조작
- [ ] 폰트 크기/대비
- [ ] 스크린리더 레이블

### 10.5 모바일·온디바이스 QA (🔴 후순위 — P0에서 제외)
- [ ] Android Chrome (백그라운드 재생)
- [ ] iOS Safari (≥26 WebGPU / 구버전 WASM, 백그라운드 한계)
- [ ] 저사양 보급폰 (첫 로딩·RTF)
- [ ] 오프라인(비행기 모드) 재생
- [ ] 모델 캐시 삭제 후 재다운로드
- [ ] iOS 잠금 30초 후 재생 동작(알려진 버그 범위 확인)

---

## 진행 요약 (수기 업데이트)

| 단계 | 우선순위 | 상태 | 메모 |
|------|---------|------|------|
| 0 사전검증 (비차단 병행) | P0 | ☐ | 실청취+한문장PoC+offset검증, 게이트5종 |
| **첫 스프린트 MVP (폐루프)** | **P0 핵심** | ☐ | 정제+청크=80% 승부, PC Chrome 단일타깃 |
| 1 셋업 | P0 | ☐ | |
| 2 텍스트 (정제·청크 완성) | P0 | ☐ | MVP에서 핵심 선행 |
| 3 엔진 | P0 | ☐ | |
| 4 캐싱 | 🔴 후순위 | ☐ | P0 제외 |
| 5 재생 (iOS 경로 제외) | P0 | ☐ | iOS는 후순위 |
| 6 배속 | P1 | ☐ | MVP 제외 |
| 7 북마크·정독 | P0 | ☐ | chunkIndex+charOffset, ms 금지 |
| 8 PWA·모바일 | 🔴 후순위 | ☐ | P0 제외 |
| 9 배포 | P0 | ☐ | |
| 10 QA (PC Chrome 위주) | P0 | ☐ | iOS·저사양은 10.5 후순위 |
| 계측·복귀율 로깅 (MVP-7) | P0(데이터)/게이트는 런칭후 | ☐ | FN-13, 복귀율=실험 게이트 |
