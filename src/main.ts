import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { settingsStore } from './lib/stores/settings.svelte'
import { syncDebugFlagFromUrl, isDebug } from './lib/debug/flag'

// 모바일(안드로이드 등)에서는 콘솔을 보기 어려우므로 화면 하단에 로그 오버레이를 띄운다.
// dev 는 항상, 프로덕션은 URL 에 `?debug=1` 을 한 번 넣으면(이후 localStorage 로 유지) 켜진다.
// → 폰 배포본에서 합성이 어디서 멈추는지(backend/synth hang/재생) 화면에서 바로 읽을 수 있다.
syncDebugFlagFromUrl()
if (isDebug()) {
  void import('./lib/debug/overlay').then((m) => m.installDebugOverlay())
}

// 설정(배속·테마 등)을 IndexedDB에서 먼저 복원한 뒤 앱을 마운트한다.
// top-level await 는 빌드 타깃(es2020)에서 미지원이라 .then() 으로 회피한다.
settingsStore.load().then(() => {
  mount(App, {
    target: document.getElementById('app')!,
  })
})
