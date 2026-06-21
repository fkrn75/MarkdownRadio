/**
 * 플랫폼 감지 유틸 — 엔진 내부 플랫폼 분기용(예: AudioContext resume 보장).
 *
 * iOS(아이폰/아이패드)는 사용자 제스처 없이는 AudioContext 가 suspended 로 시작하고,
 * iPadOS 13+ 는 데스크탑 Safari 처럼 위장(navigator.platform === 'MacIntel')하므로
 * maxTouchPoints 로 터치 기기를 구분한다.
 */

/** iOS(아이패드 포함) 감지 — AudioContext resume 보장 등 플랫폼 분기용 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}
