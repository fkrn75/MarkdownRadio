# 05 · 배포 가이드 — Cloudflare Pages

> Markdown Radio를 Cloudflare Pages(무료 정적 호스팅)에 연결·배포하는 절차.
> 리포: https://github.com/fkrn75/MarkdownRadio

---

## 현재 상태 (2026-06-21)

- ✅ GitHub 리포 생성·연결 완료 (`fkrn75/MarkdownRadio`, main 브랜치)
- ✅ `.gitignore` 준비(`dist/`, `node_modules/`, 모델 가중치 제외)
- ⏳ **아직 빌드할 앱 코드 없음(문서만)** → 아래 둘 중 하나로 진행:
  - **(권장)** Phase 1(Vite+Svelte 스캐폴딩, [04-checklist](04-checklist.md)) 완료 후 연결 → 첫 배포가 바로 성공
  - 지금 연결만 해두고, 코드 push 시점에 자동 빌드(첫 빌드는 코드 없으면 실패하므로 코드 먼저 권장)

---

## 빌드 설정값 (Vite + Svelte SPA 기준)

Cloudflare Pages에 입력할 값:

| 항목 | 값 |
|------|-----|
| Production branch | `main` |
| Framework preset | `Vite` (없으면 `None`) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` (리포 루트) |
| 환경변수 | `NODE_VERSION` = `20` (또는 `22`) |

> SvelteKit으로 전환할 경우: `@sveltejs/adapter-cloudflare` 또는 `adapter-static` 사용, output은 어댑터에 따라 다름. 현재 계획은 **Vite + Svelte SPA**라 `dist`.

---

## 방법 1 · 대시보드 연결 (권장, OAuth)

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** 탭 → **Connect to Git**
2. GitHub 인증(fkrn75) → 리포 **`MarkdownRadio`** 선택
3. 위 "빌드 설정값" 입력 → **Save and Deploy**
4. 배포 완료 후 `https://markdownradio.pages.dev` (또는 유사) URL 발급
5. 이후 `main`에 push할 때마다 자동 빌드·배포

## 방법 2 · Wrangler CLI

```bash
npm i -D wrangler
npx wrangler login                 # 브라우저 OAuth (대화형)
# 최초 1회 프로젝트 생성
npx wrangler pages project create markdown-radio --production-branch main
# 빌드 후 배포
npm run build
npx wrangler pages deploy dist --project-name markdown-radio
```

> CI 자동화가 필요하면 `CLOUDFLARE_API_TOKEN`(Pages 권한) 환경변수로 비대화형 배포 가능.

---

## ⚠️ COOP/COEP (SharedArrayBuffer) 주의

sherpa-onnx-wasm **멀티스레드** 빌드나 일부 WASM SIMD/threads 경로는 `SharedArrayBuffer`가 필요하고, 이는 **cross-origin isolation**(COOP/COEP 헤더)을 요구한다. 리포 루트의 `public/_headers`에 아래를 두면 Vite가 `dist/_headers`로 복사해 Cloudflare가 적용한다:

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

**그러나 함정:** `require-corp`를 켜면 외부 CDN(HuggingFace 등)에서 받는 모델 응답에 `Cross-Origin-Resource-Policy`/CORS가 없을 경우 **모델 다운로드가 차단**될 수 있다. 대응:

- **단일스레드 WASM 빌드**를 쓰면 COOP/COEP **불필요** → 가장 단순(초기 권장).
- 멀티스레드가 꼭 필요하면 `Cross-Origin-Embedder-Policy: credentialless`로 완화하거나, 모델을 **same-origin**(앱과 같은 도메인)에 호스팅/프록시.
- **결정은 Phase 0 PoC에서** 실제 성능을 보고 판단(대부분 한국어 경량 VITS는 단일스레드로 충분).

→ 그래서 이 헤더는 **기본 비활성**으로 두고, 멀티스레드 도입 시점에만 추가한다. (지금 켜면 모델 다운로드가 깨질 위험)

---

## 배포 후 체크 ([04-checklist](04-checklist.md) Phase 9)

- [ ] HTTPS 접속 확인
- [ ] PWA 설치 가능(매니페스트·SW 유효) — Lighthouse PWA 통과
- [ ] 폰에서 URL → 홈 화면 추가 → 실행
- [ ] 모델 다운로드·IndexedDB 캐시 동작(모바일 네트워크)
- [ ] 오프라인(비행기 모드) 재생
- [ ] (멀티스레드 사용 시) COOP/COEP 적용 + 모델 다운로드 정상 동시 확인
- [ ] 커스텀 도메인 연결(선택)

---

## 참고
- Cloudflare Pages: https://developers.cloudflare.com/pages/
- Vite 배포 가이드: https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project/
- `_headers` 문법: https://developers.cloudflare.com/pages/configuration/headers/
