import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { settingsStore } from './lib/stores/settings.svelte'

// [dev] 모바일(안드로이드 등)에서는 콘솔을 보기 어려우므로 화면 하단에 로그 오버레이를 띄운다.
// import.meta.env.DEV 가드라 프로덕션 빌드에는 포함되지 않는다.
if (import.meta.env.DEV) {
  void import('./lib/debug/overlay').then((m) => m.installDebugOverlay())
}

// 설정(배속·테마 등)을 IndexedDB에서 먼저 복원한 뒤 앱을 마운트한다.
// top-level await 는 빌드 타깃(es2020)에서 미지원이라 .then() 으로 회피한다.
settingsStore.load().then(() => {
  mount(App, {
    target: document.getElementById('app')!,
  })
})
