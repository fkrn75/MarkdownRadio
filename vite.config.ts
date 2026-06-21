import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Cloudflare Pages: build `npm run build` → output `dist` (05-deploy 참고)
export default defineConfig({
  plugins: [svelte()],
})
