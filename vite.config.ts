import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'

// Cloudflare Pages: build `npm run build` → output `dist` (05-deploy 참고)
//
// onnxruntime-web 설정(Supertonic 엔진):
//  - optimizeDeps.exclude: ort 는 자체 .wasm/.mjs 사이드카를 동적 로드하므로
//    Vite 의 의존성 사전 번들(esbuild)에서 제외해야 WASM 경로가 깨지지 않는다.
//  - build.target 'esnext': ort 와 WebGPU 경로가 top-level await/최신 문법을 쓴다.
//  - worker.format 'es': 합성 워커(supertonic.worker.ts)를 ES 모듈 워커로 번들
//    (워커 내부에서 onnxruntime-web 를 import 하므로 필수).
//
// PWA(vite-plugin-pwa / Workbox):
//  - registerType 'autoUpdate': 새 버전 배포 시 SW 가 자동 갱신(사용자 조작 불필요).
//  - injectRegister 'auto': SW 등록 코드를 자동 주입(별도 main.ts 수정 불필요 → src/ 무수정 유지).
//  ⚠️ 모델 파일(.onnx ~380MB, .bin)은 절대 precache 하지 않는다:
//     - globPatterns 를 js/css/html/png/svg/webmanifest/ico 로만 한정.
//     - globIgnores 로 모델/대용량 자산(onnx/bin/wasm/mjs/data)을 명시 차단.
//     - maximumFileSizeToCacheInBytes 5MB 로 캡 → 혹시 매칭되어도 대용량은 제외.
//     모델은 modelCache.ts 의 자체 IndexedDB 캐시로 관리하므로 SW 가 손대면 중복/용량 폭증.
export default defineConfig({
  // 실기 검증(안드로이드)용 임시 노출: cloudflared 터널의 *.trycloudflare.com Host 헤더를
  // vite dev 의 host 체크가 막지 않도록 허용. (검증 후 제거해도 무방)
  server: {
    allowedHosts: ['.trycloudflare.com'],
    // onnxruntime-web 멀티스레드 WASM(SharedArrayBuffer)을 켜려면 교차출처 격리가 필요하다.
    // 격리가 없으면 simd-threaded wasm 추론이 빈 버퍼(무음)를 낸다(안드로이드 실측).
    // credentialless: HuggingFace 등 cross-origin 모델/음성 리소스를 CORP 없이도 허용(+ SAB 활성).
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false, // public/manifest.webmanifest 를 직접 관리(중복 생성 방지)
      workbox: {
        // precache 대상: 앱 셸(소형 정적 자산)만. 모델/WASM 류는 의도적으로 제외.
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,ico}'],
        // 모델·런타임 대용량 자산 + mermaid 도식 청크(lazy)는 SW 캐시에서 차단.
        //  - 모델: IndexedDB 자체 캐시 사용. mermaid: 정독뷰 도식 있을 때만 동적 로드(첫 설치 경량 유지).
        globIgnores: ['**/*.{onnx,bin,wasm,mjs,data}', '**/mermaid-*.js'],
        // 안전망: 5MB 초과 파일은 어떤 경우에도 precache 하지 않음.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // SPA 폴백: 오프라인/새로고침 시 index.html 로 라우팅.
        navigateFallback: 'index.html',
      },
      // dev 서버에서는 SW 비활성(개발 편의 + ort WASM 경로 간섭 방지).
      devOptions: {
        enabled: false,
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // mermaid 생태계(정독뷰 도식 렌더)를 단일 'mermaid' 청크로 묶는다. dynamic import(lazy)라
        // 메인 번들엔 안 들어가고, 이 청크만 globIgnores('**/mermaid-*.js')로 precache 에서 통째 제외
        // → mermaid 를 안 쓰는 사용자의 PWA 첫 설치를 경량으로 유지한다.
        manualChunks(id) {
          if (
            /[\\/]node_modules[\\/](mermaid|@mermaid-js|cytoscape|cytoscape-[a-z-]+|dagre|dagre-d3-es|d3|d3-[a-z-]+|katex|khroma|dompurify|stylis|ts-dedent|@braintree|robust-predicates|delaunator|internmap|elkjs|lodash-es|marked|uuid|dayjs|@iconify|cose-base|layout-base|web-worker|hachure-fill|roughjs|points-on-curve|path-data-parser|points-on-path)[\\/]/.test(
              id,
            )
          ) {
            return 'mermaid'
          }
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
})
