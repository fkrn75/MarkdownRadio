# 04 · 구현 체크리스트 (Detailed Checklist)

> Markdown Radio v1.0 · 2026-06-21
> Phase 0~10. 각 항목은 독립적으로 체크 가능하도록 세분화. `[ ]`→진행 전, `[x]`→완료.
> 우선순위: **P0**=MVP 필수, **P1**=MVP 권장, **P2**=Post-MVP.
> 기능 참조: [03-functional-spec.md](03-functional-spec.md) / 근거: [01-research.md](01-research.md)

---

## Phase 0 · 사전 검증 (코드 짜기 전 — 가장 중요)

### 0.1 모델 품질 실청취 (P0)
- [ ] [Supertonic WebGPU 데모](https://huggingface.co/spaces/webml-community/Supertonic-TTS-WebGPU)에 **실제 청취할 한국어 마크다운** 붙여넣고 듣기
- [ ] [Supertone/supertonic-2 데모](https://huggingface.co/spaces/Supertone/supertonic-2)도 비교 청취
- [ ] 코드/영문 용어 섞인 문단으로 발음 확인 (예: "이 함수는 async/await로 처리한다")
- [ ] 긴 문장·숫자·날짜·단위 발음 확인
- [ ] **판정 기록**: 흘려듣기 필터링용으로 합격? (Y → Supertonic 확정 / N → 0.2)
- [ ] 화자/속도 옵션 종류 확인(모델이 제공하는 voice 목록)

### 0.2 폴백 평가 (합격 시 생략 가능)
- [ ] MeloTTS-Korean 샘플 청취 (HF 모델카드)
- [ ] MMS-tts-kor 데모로 "최저 품질" 기준선 확인
- [ ] 폴백 우선순위 결정 기록

### 0.3 라이선스 확인 (P0)
- [ ] Supertonic 모델 **OpenRAIL-M use-restriction 조항** 읽기 (수익화 계획 시)
- [ ] 개인/포트폴리오 용도면 문제없음 확인
- [ ] 완전 자유 필요 시 MeloTTS(MIT) 채택 여부 결정

### 0.4 최소 기술 PoC (P0)
- [ ] 빈 Vite 프로젝트에서 `@huggingface/transformers`로 Supertonic 로드 → **한 문장 합성·재생** 성공
- [ ] WebGPU 동작 확인 + WASM 폴백 동작 확인
- [ ] 모델 다운로드 용량·첫 로딩 시간 실측 기록
- [ ] 합성 1문장 소요 시간(RTF) 실측 (PC + 폰)
- [ ] **결론**: 이 스택으로 진행 가능 판정

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
  - [ ] `src/lib/audio/audioElementPlayer.ts`
  - [ ] `src/lib/storage/db.ts` (IndexedDB 래퍼)
  - [ ] `src/lib/storage/modelCache.ts`
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
- [ ] `vite-plugin-pwa` 설치
- [ ] (P1) sherpa-onnx-wasm 패키지/에셋 확보

### 1.3 기본 레이아웃 (P0)
- [ ] 라우팅/뷰 골격: 라이브러리 / 플레이어 / 정독 / 설정
- [ ] 다크모드 + 반응형(모바일 우선) 기본 CSS
- [ ] 한국어 폰트(Pretendard 등) + `word-break:keep-all`

---

## Phase 2 · 텍스트 파이프라인

### 2.1 문서 입력 FN-01 (P0)
- [ ] 파일 업로드(드래그앤드롭 + 버튼), `.md`/`.txt` 필터
- [ ] `FileReader` UTF-8 디코딩
- [ ] 텍스트 붙여넣기 입력
- [ ] 문서명 자동 추출(파일명/첫 헤더/첫 줄)
- [ ] 빈 입력·대용량·비지원 형식 엣지케이스 처리
- [ ] 업로드 즉시 IndexedDB `documents` 저장

### 2.2 마크다운 정제 FN-02 (P0)
- [ ] 헤더 → 텍스트 + `isHeading` 플래그
- [ ] 강조(`**`,`*`,`~~`) 마커 제거
- [ ] 코드블록 **건너뛰기**(기본) + 토글
- [ ] 인라인 코드 처리
- [ ] 링크 → 텍스트만, URL 제거
- [ ] 이미지 제거(또는 alt)
- [ ] 표 건너뛰기(기본) + 셀 나열 토글
- [ ] 리스트/인용/구분선/각주/HTML/이모지 처리
- [ ] 원문 URL → "링크" 치환
- [ ] 연속 공백·빈 줄 정규화
- [ ] **원문 행 범위(sourceLineStart/End) 보존**
- [ ] 닫히지 않은 코드블록 휴리스틱
- [ ] **정제 테스트 케이스 작성**(요소별 입력→기대 출력)

### 2.3 청크 분할 FN-03 (P0)
- [ ] 문장 경계 분할(종결부호 + 약어/소수점 보호)
- [ ] 긴 청크 강제 분할(기본 200자)
- [ ] 짧은 청크 병합
- [ ] 청크별 원문 위치 메타(line/charOffset)
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

## Phase 4 · 모델 캐싱

### 4.1 IndexedDB 캐시 FN-05 (P0)
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

### 5.1 재생 엔진 FN-06 (P0)
- [ ] `WebAudioPlayer`(PC/Android): AudioBuffer 큐 + gapless
- [ ] 다음 청크 **프리페치**(≥1) 파이프라인
- [ ] 첫 청크 준비되면 즉시 재생 시작
- [ ] 합성이 재생 못 따라갈 때 버퍼링 처리
- [ ] 재생 상태/위치/현재청크 실시간 노출(store)
- [ ] 마지막 청크 종료 처리(ended)
- [ ] 문서 전환 시 정지·합성 취소

### 5.2 iOS 재생 경로 FN-06/12 (P0)
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

---

## Phase 6 · 배속

### 6.1 피치 보존 배속 FN-08 (P0)
- [ ] `<audio>` 경로: `preservesPitch=true` + `playbackRate`
- [ ] Web Audio 경로: 합성단 speed(length-scale) 조절 1차
- [ ] 배속 옵션 UI(0.75~2.0x)
- [ ] 배속 변경 즉시 적용·위치 유지
- [ ] 배속 설정 `settings` 저장
- [ ] (P1) 고품질 타임스트레치(soundtouch/rubberband) 검토

---

## Phase 7 · 북마크 & 정독

### 7.1 prefix-sum 매핑 FN-09 (P0)
- [ ] 합성 후 `durationSec` → `cumStart` prefix-sum 계산
- [ ] `globalTime → 이진탐색 → chunk → 원문 위치` 역산
- [ ] 단일 audio 경로(currentTime) / 청크 경로 둘 다 정확

### 7.2 북마크 FN-09 (P0)
- [ ] 북마크 버튼 → 현재 위치 기록(IndexedDB `bookmarks`)
- [ ] previewText(앞 30자) 저장
- [ ] 북마크 목록(문서별) 조회·삭제
- [ ] 피드백(토스트/햅틱)
- [ ] 문서 삭제 시 북마크 cascade 삭제
- [ ] 배속·seek 후 매핑 정확성 테스트

### 7.3 정독 뷰 FN-10 (P0)
- [ ] 원문 **마크다운 렌더**(코드/표 시각 표시)
- [ ] 북마크 클릭 → 스크롤 + 하이라이트
- [ ] 재생 중 현재 문장 동기 하이라이트
- [ ] (P1) 문장 클릭 → 그 지점부터 재생
- [ ] (P1) 긴 문서 가상 스크롤

### 7.4 라이브러리 FN-11 (P1)
- [ ] 문서 목록(제목/날짜/길이/북마크수)
- [ ] 선택·삭제
- [ ] 마지막 위치 이어듣기
- [ ] (P2) 검색/정렬

---

## Phase 8 · PWA & 모바일

### 8.1 PWA FN-12 (P0)
- [ ] `manifest.webmanifest`(name/icons 192·512·maskable/standalone/start_url/theme)
- [ ] 아이콘 에셋 제작(192/512/maskable)
- [ ] vite-plugin-pwa(Workbox generateSW, autoUpdate)
- [ ] 앱셸 precache(**모델은 제외** — IDB가 담당)
- [ ] 오프라인 동작 확인(앱셸 + 캐시된 모델)

### 8.2 MediaSession (P0)
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

### 10.1 기기·브라우저 (P0)
- [ ] Chrome 데스크탑 (WebGPU)
- [ ] Edge / Firefox 데스크탑 (WASM 폴백 포함)
- [ ] Safari 데스크탑
- [ ] Android Chrome (백그라운드 재생)
- [ ] iOS Safari (≥26 WebGPU / 구버전 WASM, 백그라운드 한계)
- [ ] 저사양 보급폰 (첫 로딩·RTF)

### 10.2 기능 시나리오 (P0)
- [ ] 긴 문서(수천 자) 끊김 없는 연속 재생
- [ ] 코드블록·표·링크 많은 문서 정제 품질
- [ ] 영문/숫자/단위 혼재 발음
- [ ] 북마크 → 정독 점프 정확도(배속·seek 후 포함)
- [ ] 오프라인(비행기 모드) 재생
- [ ] 모델 캐시 삭제 후 재다운로드
- [ ] 재생 중 문서 전환·중단

### 10.3 엣지/내구성 (P1)
- [ ] 빈/깨진/거대 파일
- [ ] 저장 쿼터 초과
- [ ] 다운로드 중 네트워크 끊김
- [ ] 1시간+ 장시간 청취 메모리 누수 점검
- [ ] iOS 잠금 30초 후 재생 동작(알려진 버그 범위 확인)

### 10.4 접근성 (P1)
- [ ] 키보드 전용 조작
- [ ] 폰트 크기/대비
- [ ] 스크린리더 레이블

---

## 진행 요약 (수기 업데이트)

| Phase | 상태 | 메모 |
|-------|------|------|
| 0 사전검증 | ☐ | 데모 청취부터 |
| 1 셋업 | ☐ | |
| 2 텍스트 | ☐ | |
| 3 엔진 | ☐ | |
| 4 캐싱 | ☐ | |
| 5 재생 | ☐ | |
| 6 배속 | ☐ | |
| 7 북마크·정독 | ☐ | |
| 8 PWA | ☐ | |
| 9 배포 | ☐ | |
| 10 QA | ☐ | |
