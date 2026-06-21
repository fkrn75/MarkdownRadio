# 01 · 리서치 기록 (Research Log)

> Markdown Radio 프로젝트의 기술 타당성 조사 전체 기록.
> 작성: 2026-06-21 · 방법: deep-research 하니스(6개 검색 각도 · 27개 1차 소스 · 125개 주장 추출 → 25개 적대적 3표 검증) + 모델/구현 정밀 조사 2건.

---

## 0. 조사 목적

사용자 기획서("AI 정보 소비용 성우 라디오")의 핵심 기술 가정이 2026년 현재 실현 가능한지 **회의적으로** 검증하고, 한국어·PC+모바일·무료 제약에 맞는 최적 아키텍처와 모델을 선정한다.

확정된 제약 (조사 착수 전 사용자 확인):
1. **언어: 한국어 중심** (코드/영문 용어 혼재 처리 포함)
2. **실행 방식: 경로 A(완전 온디바이스·무료)로 확정** (초기에는 A/B 둘 다 비교 → 사용자가 A 선택)
3. **기기: 모바일 + PC 둘 다 1급**

---

## 1. 깨진 가정 3가지 (high confidence, 적대적 검증 통과)

### ① "100MB 온디바이스 모델로 Gemini급 한국어 성우" → ❌ 비현실적

- 브라우저 100% 로컬 실행되는 대표 경량 TTS인 **Kokoro-82M은 한국어를 지원하지 않는다.** 공식 보이스 9개 언어(영·일·중·스페인·프랑스·힌디·이탈리아·포르투갈)에 한국어 없음. 브라우저용 `kokoro-js`는 영어 28보이스만 활성, TODO 목록에도 한국어 없음.
- 경량 TTS는 **구조적으로** 성우 수준 표현력 한계. arXiv 2512.08006(2025-12) 저자 자인: *"음소 시퀀스를 완벽히 교정해도 완전한 자연스러움은 도달 불가. 경량 TTS 모델은 phoneme-to-speech 구성요소의 용량이 제한적이라 고차원 운율·표현력을 재현하기에 부족하다."*
- **판정:** 온디바이스 경량 모델의 현실적 상한은 **"알아듣기 편한 중립 합성음"**. 흘려듣기 1차 필터링엔 충분하나 "성우/오디오북 표현력" 기대치는 하향 조정 필요.
- 단, "경량화가 *항상* 자연스러움을 해친다"는 일반 명제는 검증에서 **반증(0-3)**됨 — 모델/데이터에 따라 다름. 그래서 한국어 전용 고품질 경량 모델(Supertonic 등)을 찾는 것이 정답.

### ② "Streamlit + 브라우저 내 WebGPU 실행" → ❌ 양립 불가능

- Streamlit은 **모든 연산을 서버에서 수행하는 서버사이드 Python 프레임워크.** 공식 문서: *"앱의 Python 백엔드가 서버다... 모든 사용자의 연산을 수행한다. 브라우저로 접속하는 사용자의 기기는 단지 클라이언트일 뿐."*
- "브라우저 내 WebGPU/WASM 실행(transformers.js)"은 **클라이언트 측 JS 추론**이라 방향이 정반대. 한 프레임워크에 담을 수 없다.
- Streamlit Community Cloud 무료 티어: RAM 최대 **2.7GB**, CPU 최대 **2코어**, **GPU 없음** → 수 GB급 TTS 서버 추론 부적합 (XTTS-v2는 로드 시 ~5GB).
- **판정:** 온디바이스 경로의 올바른 배포는 **정적 PWA(Vite/Svelte) + Cloudflare Pages**.

### ③ "ZeroGPU 등 무료 서버리스로 비용 0원" → ⚠️ 사실상 무료 아님

- HuggingFace ZeroGPU로 **내 모델을 띄우려면(셀프호스팅) PRO 구독(유료)** 필요. 무료 계정은 남의 Space 사용만 가능, GPU 할당 하루 **5분(비로그인 2분)**.
- **판정:** 항시 가동 무료 백엔드는 비현실적. → 경로 A(온디바이스)가 진짜 0원을 달성하는 유일한 길.

---

## 2. 한국어 온디바이스 TTS 모델 전수 비교 ★ 핵심

> **[확인]** = 1차 출처 검증, **[주의]** = 출처 충돌/해석 필요, **[미확인]** = 출처에서 확인 불가

| 모델 | 한국어 | 브라우저 온디바이스 | 라이선스(상업) | 크기 | 품질 | 판정 |
|------|:---:|---|---|:---:|:---:|:---:|
| **Supertonic** (Supertone) | ✅ 공식·한국어 샘플 | ✅ **공식 WebGPU/WASM 라이브 데모** + sherpa + transformers.js | 코드 MIT / 모델 OpenRAIL-M (⭕, 제한조항) | ~99M params(int8 실파일 크기는 PoC 실측) | **상 추정(실청취 전 미검증)** | **🥇 1순위** |
| **MeloTTS-Korean** | ✅ 공식 | ⚠️ 원리상 가능, **브라우저 실증 공백** | **MIT** (가장 자유) | INT8 ~45 / FP16 ~85MB | 상 | 🥈 폴백 |
| **mms-tts-kor** (Meta MMS) | ✅ 공식 | ✅ transformers.js VITS **즉시** | ❌ **CC-BY-NC** | quant 38.4MB | 중하 (로마자 변환) | 프로토용 |
| **OuteTTS-0.2-500M** | ✅ 공식 | ✅ transformers.js + WebGPU 데모 | ❌ CC-BY-NC | 500M(q4) | 미확인 | 비상업 대안 |
| **Piper** (rhasspy) | ⚠️ 공식 voice 없음 | ⚠️ 한국어 라이브 데모 부재 | 비공식 NC | ~63MB | 미확인 | 부적합 |
| Kokoro / Kitten / Parler | ❌ 미지원 | — | Apache-2.0 | — | — | 탈락 |
| Coqui XTTS-v2 | ✅ | ❌ 브라우저 불가(1.87GB) | ❌ NC + 회사 폐업 | 1.87GB | — | 탈락 |

### 2.1 Supertonic — 1순위 [확인]

- **한국어**: Supertonic-3 모델카드에 한국어 샘플 직접 게시 (예: 노인 캐릭터 음성 *"혼자 떠나기엔 길이 험하구나..."*). v2부터 한국어 1차 지원, v3는 31개어. **제작사가 한국 음성 AI 전문기업**이라 기대치는 높으나 **실제 한국어 청취 품질은 PoC 전까지 미검증**.
- **브라우저**: 공식 `web/`(WebGPU/WASM, onnxruntime-web) + transformers.js 통합. 라이브 데모(`webml-community/Supertonic-TTS-WebGPU`, `Supertone/supertonic-2`)에서 "100% 로컬, 데이터 외부 전송 없음" + **한국어 선택 가능**. sherpa-onnx 공식 int8 패키지도 제공.
- **라이선스**: 코드 MIT / 모델 **OpenRAIL-M (상업 사용 허용, use-restriction 승계 의무)**. MMS/OuteTTS의 CC-BY-NC보다 결정적 우위.
- **크기/속도**: ~99M params, 44.1kHz (int8 실파일 크기는 PoC 실측). **RTF 0.3×는 Onyx Boox Go6 e-reader+airplane mode 측정값으로 모바일/데스크탑 브라우저 일반 보장치가 아님(PoC로 재측정)**. M1 Mac 1000+ chars/sec.
- **착수 전 확인 3가지** (차단요소 아님): ① OpenRAIL-M use-restriction 조항 검토 ② 한국어 실청취 품질 PoC ③ **inference steps(total_steps 기본 8, 범위 5~12)별 품질↔속도 트레이드오프 측정**. RTF는 이 값을 명시해 측정.

### 2.2 MeloTTS-Korean — 폴백 [확인]

- 한국어 전용 공식 체크포인트, 월 11만 다운로드. **MIT(상업/비상업 완전 자유)** — 라이선스 최강.
- ONNX 변환본 존재 (`gnyong/melotts-kr-onnx`: INT8 ~45 / FP16 ~85MB).
- **약점**: sherpa-onnx 공식 목록엔 중/영(vits-melo-tts-zh_en)만, 한국어 미등재. ONNX 카드도 Android/iOS·서버만 명시 → **브라우저(onnxruntime-web) + 한국어 G2P 전처리 이식이 미검증**. ONNX 변환본은 BERT 임베딩·tone ID를 0 처리해 운율 일부 제한. **자체 PoC 부담이 가장 큼.**

### 2.3 mms-tts-kor (Meta MMS) — 빠른 프로토타입용 [확인/주의]

- **브라우저 실행성 최강**: transformers.js VITS 공식 지원, `pipeline('text-to-speech', 'Xenova/mms-tts-kor')` 즉시 동작. ONNX quantized **38.4MB**.
- **결격 2가지**: ① **CC-BY-NC = 상업 불가** ② 한국어를 uroman으로 **로마자 변환 후 처리**(한글 직접 입력 아님) → 발음·억양 불리, 품질 중하.
- **용도**: 라이선스/품질 무관하게 "전체 플로우를 가장 빨리 돌려볼 때"만.

### 2.4 폴백의 폴백 [확인]

- sherpa-onnx 공식 사전학습 한국어 VITS `vits-mimic3-ko_KO-kss_low` 실재 (KSS 단일화자, mimic3 출신). **확실히 동작하나 저용량·기계음 톤** 예상. 다른 모든 경로가 막혔을 때의 안전망.

---

## 3. 경로 A vs 경로 B (참고 — B는 보류)

| 기준 | 경로 A (온디바이스·무료) ★채택 | 경로 B (서버·품질우선) |
|------|------------------------|----------------------|
| 한국어 품질 | 준수~상 (★★★☆☆~★★★★☆) | 자연스러움 우위 (★★★★☆) |
| 비용 | **진짜 0원** | GPU 비용, 완전 0원 난망 |
| 지속가능성 | ✅ 높음 (외부 의존 없음) | ⚠️ 무료 티어 정책 종속 |
| 오프라인 | ✅ 가능 | ❌ 불가 |
| 기기 호환 | ⚠️ WebGPU 편차, 첫 로딩 느림 | ✅ 균일 |

> **경로 B 보류 메모** (나중에 품질 욕심 시): XTTS-v2 / F5-TTS / GPT-SoVITS 한국어 실측 비교 대상. **CosyVoice2의 한국어 공식 지원은 검증에서 반증(1-2)**되었으므로 단독 채택 금지. 모두 GPU 필수.

---

## 4. 구현 기술 조사

### 4.1 브라우저 TTS 런타임

| 런타임 | 한국어 모델 | WebGPU | WASM 폴백 | 비고 |
|--------|---|:---:|:---:|------|
| **transformers.js** (@huggingface/transformers) | Supertonic, MMS | ✅ `device:"webgpu"` | ✅ | 문서 최상. Supertonic 공식 통합 |
| **sherpa-onnx-wasm** | VITS 한국어(`vits-mimic3-ko_KO-kss_low`), Supertonic int8 | ❌ (WASM 전용) | ✅ 기본 | iOS 포함 전 브라우저. 멀티스레드 시 COOP/COEP 필요 |
| ONNX Runtime Web (raw) | 직접 배선 | ✅ | ✅ | 전·후처리(음소화) 직접 구현 → 손많음 |
| piper-wasm | 한국어 빈약 | 일부 포크 | ✅ | 포크 난립 |
| **Web Speech API** (SpeechSynthesis) | OS/브라우저 내장 보이스 | — | — | 한국어는 OS/브라우저 내장 보이스에 종속, 보장 아님. **v0 가치검증 부트스트랩 전용.** 정체성 엔진은 Supertonic |

- **권장**: Supertonic을 **transformers.js**(WebGPU 가속)로 메인. iOS/구형 폴백이나 다른 모델 필요 시 **sherpa-onnx-wasm**. → `engine.ts`로 추상화해 교체 가능하게.
- WebGPU는 한국어 경량 VITS엔 필수 아님(WASM/CPU로 실시간 충분). 트랜스포머형 모델에서만 큰 이득.

### 4.2 모델 캐싱 / 오프라인

- **transformers.js**: 자체 **Cache API** 캐싱 자동(`env.useBrowserCache=true`). 오프라인 고정은 `env.allowRemoteModels=false`.
- **대용량 모델 바이너리(수십~150MB)** → **IndexedDB** 권장 (raw ArrayBuffer 저장, SW 활성 전에도 접근 가능).
- **앱셸(HTML/JS/WASM glue)** → Service Worker + Cache API (Workbox precache).
- **스토리지 쿼터**: Chrome ~디스크 60% / Firefox ~50% / **Safari ~오리진당 1GB** → 한국어 모델(수십 MB)은 iOS도 여유.
- ⚠️ **iOS 주의**: PWA 캐시 "7일 미사용 시 자동 삭제" 보고 → **앱 실행 때마다 모델 존재 확인 → 없으면 재다운로드** 로직 필수 (+ 진행률 UI).

### 4.3 연속 재생 (gapless)

- 파이프라인: 문장 청크 분할 → **Web Worker**에서 합성 → **다음 청크 미리 합성(프리페치)** → 재생.
- 진짜 무갭은 `AudioContext.currentTime` 기준 look-ahead 스케줄링(`start(nextStartTime)`, `nextStartTime += buffer.duration`). 라디오형 앱은 문장 사이 짧은 무음이 자연스러워 `onended` 체이닝으로도 충분.

### 4.4 iOS Safari 백그라운드 (가장 큰 제약) [확인]

- iOS에서 **Web Audio(AudioContext)는 화면 잠금/백그라운드 시 즉시 suspend** → 청크를 AudioBufferSourceNode로 순차재생하면 잠금화면에서 끊김.
- **우회**: iOS는 **청크 합성 → 하나의 긴 WAV Blob으로 이어붙여 `<audio src>` 재생**. 단일 HTMLAudioElement는 잠금화면 재생·MediaSession이 (제한적으로) 동작.
- ✅ **정정**: **WebKit#198277은 `<audio>` 엘리먼트 문제로 iOS 15.4(2022-02)에서 해결됨.** 따라서 '백그라운드 완전 불가'는 과장. **단일 `<audio>` 경로는 잠금화면 재생·MediaSession 동작.** 단 **Web Audio(AudioContext)는 background에서 ambient 취급돼 suspend 잔존**, 일시정지 30초 후 잠금화면 play 먹통 버그 잔존. WakeLock으로 우회 불가(iOS 미지원).
- PC/Android는 Web Audio 청크 파이프라인으로 정상.

### 4.5 배속 (피치 보존) [확인]

- **`<audio>` 경로**: `audio.playbackRate=1.5; audio.preservesPitch=true`(기본 true)로 완성. **Baseline 2023** (모던 브라우저 전반). iOS 경로와 자연 호환 → **기본 권장.**
- **Web Audio 경로**: `source.playbackRate`는 피치도 변함(다람쥐 소리). → ①합성 자체를 빠른 speed로 생성(VITS의 speed/length-scale 조절, sherpa·transformers 모두 지원) 또는 ②soundtouch.js/rubberband-wasm 워크릿. **①이 최저비용.**

### 4.6 재생위치 ↔ 원문 매핑 (북마크)

```
chunkMeta[i] = { sourceLineStart, sourceCharOffset, durationSec }
cumStart[i]  = Σ duration[0..i-1]               // prefix sum
locate(t)    = chunkMeta[ upperBound(cumStart, t) - 1 ].sourceLineStart  // 이진탐색
bookmark     = { chunkIndex, sourceCharOffset, createdAt }   // IndexedDB 저장
```
- 단일 audio 경로면 `audio.currentTime`이 곧 globalTime → 그대로 적용.
- 청크 순차(Web Audio) 경로면 `재생중 chunkIndex + 현재 source 경과`로 합산.
- 북마크 점프: 저장된 chunkIndex로 이동 + 원문 뷰를 sourceCharOffset으로 스크롤·하이라이트.

### 4.7 PWA / 배포

- **vite-plugin-pwa** (Workbox generateSW, `registerType:'autoUpdate'`). ⚠️ precache는 기본 css/js/html만 → **WASM·모델은 globPatterns 명시 또는 IndexedDB로**(권장).
- **manifest**: name/icons/`display:"standalone"`/start_url/theme_color. iOS는 자동 설치 프롬프트 없음 → "공유→홈 화면에 추가" 안내 UI 필요.
- **MediaSession API**: 잠금화면 컨트롤(play/pause/next/prev/seek), 메타데이터(title/artist/artwork).
- **배포**: Cloudflare Pages 무료(500 deploy/월). sherpa 멀티스레드 빌드 시 `_headers`에 COOP/COEP 추가(SharedArrayBuffer).

### 4.8 WebGPU 가용성 (2026)

- Chrome/Edge 113+(데스크탑)·Android 121+. **Safari: iOS 26 / macOS Tahoe 26부터**. Firefox Windows 141+. 글로벌 ~80%대(추정).
- 이 앱은 **WASM 기본**, WebGPU는 `if (navigator.gpu)` 분기 가속. 미지원 시 첫 로딩 진행률 UI 필수.

---

## 5. 미해결 / 착수 전 PoC 필요

1. **Supertonic 한국어 실청취 품질** — 공식 데모에서 실제 자료로 확인 (가장 먼저).
2. **MeloTTS-Korean ONNX의 브라우저 실행** — onnxruntime-web 이식 + 한국어 G2P. Supertonic 불만족 시.
3. **코드·영문 혼재 정제 규칙** — 영문 약어·코드블록·URL·표 처리.
4. **iOS Safari 백그라운드 연속 재생 안정성** — 실기기 테스트.
5. **PoC 정량 측정 묶음** — 콜드스타트 + RTF(steps 5/8/12 × 기기별) + 백그라운드 생존 + 실파일 크기 + 실청취 A/B. **이 5종 = Supertonic 채택 게이트, 미달 시 MeloTTS 폴백.**

---

## 6. 전체 출처

### 모델
- Supertonic: https://huggingface.co/Supertone/supertonic-3 · https://github.com/supertone-inc/supertonic · https://huggingface.co/spaces/webml-community/Supertonic-TTS-WebGPU · https://huggingface.co/spaces/Supertone/supertonic-2 · https://supertonictts.com/
- MeloTTS-Korean: https://huggingface.co/myshell-ai/MeloTTS-Korean · https://github.com/myshell-ai/MeloTTS/blob/main/LICENSE · https://huggingface.co/gnyong/melotts-kr-onnx
- MMS: https://huggingface.co/facebook/mms-tts-kor · https://huggingface.co/Xenova/mms-tts-kor
- OuteTTS: https://huggingface.co/spaces/webml-community/OuteTTS-WebGPU · https://huggingface.co/onnx-community/OuteTTS-0.2-500M
- Kokoro: https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md · https://github.com/hexgrad/kokoro/issues/294
- Piper: https://github.com/rhasspy/piper/blob/master/VOICES.md · https://github.com/rhasspy/piper/discussions/680
- Coqui: https://github.com/coqui-ai/TTS/issues/3714
- 경량 TTS 한계 논문: https://arxiv.org/html/2512.08006v1

### 런타임 / 구현
- transformers.js: https://huggingface.co/docs/transformers.js/index · https://huggingface.co/docs/transformers.js/en/api/env · https://github.com/huggingface/skills/blob/main/skills/transformers-js/references/CACHE.md
- sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx · https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/vits.html · https://k2-fsa.github.io/sherpa/onnx/tts/wasm/hf-spaces.html · https://github.com/k2-fsa/sherpa-onnx/issues/846
- 캐싱/IDB: https://www.sitepoint.com/optimizing-transformers-js-production/ · https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- Web Audio/gapless: https://webaudioapi.com/book/Web_Audio_API_Boris_Smus_html/ch02.html · https://github.com/RelistenNet/gapless.js
- iOS 백그라운드: https://developer.apple.com/forums/thread/762582 · https://bugs.webkit.org/show_bug.cgi?id=198277
- 배속: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch
- MediaSession: https://developer.mozilla.org/en-US/docs/Web/API/MediaSession · https://web.dev/articles/media-session
- PWA/Vite: https://vite-pwa-org.netlify.app/guide/service-worker-precache · https://vite-pwa-org.netlify.app/workbox/generate-sw
- 마크다운 정제: https://www.npmjs.com/package/markdown-to-txt
- WebGPU 현황: https://web.dev/blog/webgpu-supported-major-browsers · https://appdevelopermagazine.com/webgpu-in-ios-26/

### 인프라 (경로 A 확정 근거)
- Streamlit: https://docs.streamlit.io/develop/concepts/architecture/architecture · https://docs.streamlit.io/deploy/streamlit-community-cloud/manage-your-app
- ZeroGPU: https://huggingface.co/docs/hub/en/spaces-zerogpu
- Cloudflare Pages: https://developers.cloudflare.com/pages/
