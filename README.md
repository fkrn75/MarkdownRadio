# Markdown Radio 📻

> AI 검색 결과·논문·테크 블로그 같은 **한국어 마크다운/텍스트 자료를 성우 톤으로 읽어주는 "라디오"**.
> 귀로 흘려들으며 맥락을 잡고(1단계), 중요한 곳은 북마크해 두었다가, 나중에 눈으로 정독한다(2단계).

- **완전 무료 · 100% 온디바이스**: TTS 모델이 사용자 브라우저 안에서 직접 돈다. 서버 추론·API 비용 0원.
- **한국어 중심**: 한국 음성 AI 기업 모델(Supertonic)을 1순위로 채택.
- **PC + 모바일**: 정적 PWA로 배포, 홈 화면에 추가해 라디오처럼 청취.

---

## 핵심 결정 요약 (2026-06-21)

| 항목 | 결정 | 근거 |
|------|------|------|
| 실행 방식 | **경로 A — 완전 온디바이스·무료** | 사용자 확정. 비용 0원·오프라인·프라이버시 |
| TTS 모델 | **Supertonic** (1순위) / MeloTTS-Korean (폴백) | 한국어 품질 + 브라우저 실행 공식 입증 + 경량 |
| 프레임워크 | **Vite + Svelte + TypeScript** | 경량 번들, 정적 빌드 |
| TTS 런타임 | **transformers.js** (WebGPU) / **sherpa-onnx-wasm** (전 브라우저) | 모델별 교체 가능하게 추상화 |
| 모델 캐싱 | **IndexedDB** (1회 다운로드 후 오프라인) | iOS 캐시 만료 대응 |
| 배포 | **Cloudflare Pages** (무료 정적 호스팅) | — |

> ⚠️ 원래 기획서의 "Streamlit + 브라우저 내 실행"은 아키텍처적으로 양립 불가능해 폐기했고, "Kokoro 온디바이스 한국어"는 Kokoro가 한국어를 지원하지 않아 폐기했다. 자세한 근거는 [docs/01-research.md](docs/01-research.md).

---

## 문서

| 문서 | 내용 |
|------|------|
| [docs/01-research.md](docs/01-research.md) | **리서치 기록** — 조사 방법, 깨진 가정, 모델 전수 비교, 기술 조사, 전체 출처 |
| [docs/02-prd.md](docs/02-prd.md) | **기획서(PRD)** — 비전, 사용자, 가치, 범위, 마일스톤 |
| [docs/03-functional-spec.md](docs/03-functional-spec.md) | **세부 기능명세서** — 기능별 동작·입출력·데이터 모델·엣지케이스 |
| [docs/04-checklist.md](docs/04-checklist.md) | **구현 체크리스트** — Phase 0~10 단계별 세분화 태스크 |

---

## 가장 먼저 할 일 (10분, 무료)

코드 한 줄 짜기 전에 **한국어 음질을 귀로 확인**한다. 실제 청취할 한국어 마크다운을 붙여넣고 들어볼 것:

- 🔊 [Supertonic WebGPU 데모](https://huggingface.co/spaces/webml-community/Supertonic-TTS-WebGPU)
- 🔊 [Supertone/supertonic-2 데모](https://huggingface.co/spaces/Supertone/supertonic-2)

음질이 "흘려듣기 필터링용"으로 합격이면 → Supertonic 확정. 기대 이하면 → MeloTTS-Korean(MIT)으로 폴백 PoC.

---

## 기술 스택

```
Vite + Svelte + TypeScript
 ├─ TTS 런타임: @huggingface/transformers (WebGPU) │ sherpa-onnx-wasm (WASM 폴백)
 ├─ 모델: Supertonic (int8 ~97MB) │ MeloTTS-Korean (폴백)
 ├─ 합성: Web Worker + 다음 청크 선행 프리페치
 ├─ 재생: Web Audio 큐 (PC/Android) │ 이어붙인 WAV→<audio> (iOS)
 ├─ 저장: IndexedDB (모델·문서·북마크) + Cache API (앱셸)
 ├─ PWA: vite-plugin-pwa (Workbox) + MediaSession API
 └─ 배포: Cloudflare Pages (정적, 무료)
```

## 라이선스 메모

- 코드: 미정 (개인 프로젝트)
- **Supertonic**: 코드 MIT / 모델 OpenRAIL-M (상업 사용 가능, use-restriction 조항 존재 → 수익화 시 검토)
- **MeloTTS-Korean**: MIT (상업/비상업 자유)
- ⚠️ MMS-tts-kor은 CC-BY-NC(상업 불가) — 빠른 프로토타입에만 사용

---

_생성: 2026-06-21 · 조사 기반: deep-research(110 에이전트) + 모델/구현 정밀 조사 2건_
