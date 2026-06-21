/**
 * dev 전용 화면 콘솔 오버레이.
 *
 * 모바일(안드로이드 크롬 등)은 데스크탑처럼 DevTools 콘솔을 보기 어렵다.
 * 이 모듈은 console.log/info/warn/error 와 전역 에러를 가로채 화면 하단에
 * 그대로 출력해, 원격 디버깅 없이도 폰에서 로그를 읽을 수 있게 한다.
 *
 * import.meta.env.DEV 일 때만 main.ts 에서 동적 import 하므로 프로덕션엔 포함되지 않는다.
 */
export function installDebugOverlay(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('__dbg_overlay')) return // 중복 설치 방지

  const box = document.createElement('div')
  box.id = '__dbg_overlay'
  box.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;max-height:42vh;overflow:auto;z-index:99999;' +
    'background:rgba(0,0,0,.85);color:#9f9;font:11px/1.45 ui-monospace,monospace;' +
    'padding:6px 8px;white-space:pre-wrap;word-break:break-all;border-top:1px solid #333'

  const title = document.createElement('div')
  title.textContent = '— debug log (여기 탭하면 지움) —'
  title.style.cssText = 'color:#888;cursor:pointer;margin-bottom:4px'
  title.onclick = () => {
    box.querySelectorAll('.l').forEach((n) => n.remove())
  }
  box.appendChild(title)
  document.body.appendChild(box)

  const add = (level: string, args: unknown[]): void => {
    const line = document.createElement('div')
    line.className = 'l'
    line.style.color = level === 'error' ? '#f77' : level === 'warn' ? '#fd6' : '#9f9'
    line.textContent =
      `[${level}] ` +
      args
        .map((a) => {
          try {
            return typeof a === 'object' ? JSON.stringify(a) : String(a)
          } catch {
            return String(a)
          }
        })
        .join(' ')
    box.appendChild(line)
    box.scrollTop = box.scrollHeight
  }

  for (const lvl of ['log', 'info', 'warn', 'error'] as const) {
    const orig = console[lvl].bind(console)
    console[lvl] = (...args: unknown[]): void => {
      orig(...args)
      add(lvl, args)
    }
  }
  window.addEventListener('error', (e) => add('error', ['window.onerror:', e.message]))
  window.addEventListener('unhandledrejection', (e) =>
    add('error', ['unhandledrejection:', String((e as PromiseRejectionEvent).reason)]),
  )
}
