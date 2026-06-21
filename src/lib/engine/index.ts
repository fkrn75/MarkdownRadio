/**
 * FN-04 · 엔진 팩토리
 *
 * UI는 RadioEngine 인터페이스만 본다. 실제 구체 엔진 선택은 여기서 캡슐화한다.
 * 현재는 부트스트랩 폴백인 Web Speech 만 지원하고, 정체성 엔진 'supertonic'은
 * 향후(온디바이스 도입 단계)에 추가한다 — 지금은 webspeech 로 폴백 + 경고.
 */

import type { EngineKind, RadioEngine } from '../types'
import { WebSpeechEngine, type EngineDocContext } from './webSpeechEngine'

export { WebSpeechEngine } from './webSpeechEngine'
export type { EngineDocContext } from './webSpeechEngine'

/**
 * 엔진 생성. kind 미지정 시 webspeech.
 * @param kind 'webspeech'(기본) | 'supertonic'(미구현 → webspeech 폴백)
 * @param ctx  계측용 문서 컨텍스트(선택). UI가 나중에 engine.setDocContext 로 주입해도 됨.
 */
export function createEngine(kind: EngineKind = 'webspeech', ctx?: EngineDocContext): RadioEngine {
  if (kind === 'supertonic') {
    console.warn(
      "[createEngine] 'supertonic' 엔진은 아직 미구현입니다. Web Speech 부트스트랩으로 폴백합니다.",
    )
    return new WebSpeechEngine(ctx)
  }
  return new WebSpeechEngine(ctx)
}
