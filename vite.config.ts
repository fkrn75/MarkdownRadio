import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Cloudflare Pages: build `npm run build` → output `dist` (05-deploy 참고)
//
// onnxruntime-web 설정(Supertonic 엔진):
//  - optimizeDeps.exclude: ort 는 자체 .wasm/.mjs 사이드카를 동적 로드하므로
//    Vite 의 의존성 사전 번들(esbuild)에서 제외해야 WASM 경로가 깨지지 않는다.
//  - build.target 'esnext': ort 와 WebGPU 경로가 top-level await/최신 문법을 쓴다.
//  - worker.format 'es': 합성 워커(supertonic.worker.ts)를 ES 모듈 워커로 번들
//    (워커 내부에서 onnxruntime-web 를 import 하므로 필수).
export default defineConfig({
  plugins: [svelte()],
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
})
