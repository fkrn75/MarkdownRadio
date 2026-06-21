import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { settingsStore } from './lib/stores/settings.svelte'

// 설정(배속·테마 등)을 IndexedDB에서 먼저 복원한 뒤 앱을 마운트한다.
// top-level await 는 빌드 타깃(es2020)에서 미지원이라 .then() 으로 회피한다.
settingsStore.load().then(() => {
  mount(App, {
    target: document.getElementById('app')!,
  })
})
