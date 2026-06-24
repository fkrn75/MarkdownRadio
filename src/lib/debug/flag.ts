/**
 * 디버그 모드 플래그.
 *
 * 프로덕션(배포본)에서도 폰에서 무슨 일이 일어나는지 보려면 화면 로그가 필요하다.
 * URL 에 `?debug=1` 이 한 번이라도 들어오면 localStorage 에 박아두고, 이후 새로고침/PWA
 * 재방문에도 유지한다. `?debug=0` 으로 끈다. import.meta.env.DEV 면 항상 켜진 것으로 본다.
 *
 * 주의: 이 모듈은 부작용 없는 순수 판별만 한다. URL→localStorage 반영은 main.ts 가 부팅 때 1회.
 */
const KEY = 'mr_debug'

/** main.ts 부팅 시 1회 호출 — URL 의 ?debug=1|0 을 localStorage 에 반영한다. */
export function syncDebugFlagFromUrl(): void {
  if (typeof location === 'undefined' || typeof localStorage === 'undefined') return
  const v = new URLSearchParams(location.search).get('debug')
  if (v === '1') localStorage.setItem(KEY, '1')
  else if (v === '0') localStorage.removeItem(KEY)
}

/** 디버그 모드 여부(DEV 이거나 ?debug=1 로 켠 경우). */
export function isDebug(): boolean {
  if (import.meta.env.DEV) return true
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
