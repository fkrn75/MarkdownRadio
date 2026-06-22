/**
 * refine 모듈 공개 진입점.
 *
 * buildChunks: 원문 → 정제(refineMarkdown) → 청크(chunkify) → 불변식 검증(assertChunkInvariant)
 * 까지 한 번에 수행한다. UI 팀원은 이 함수만 import 하면 된다.
 */
import type { CleanBlock, Chunk, RefineOptions, ChunkOptions } from '../types.ts'
import { DEFAULT_REFINE_OPTIONS, DEFAULT_CHUNK_OPTIONS } from '../types.ts'
import { refineMarkdown } from './refine.ts'
import { chunkify } from './chunk.ts'
import { assertChunkInvariant, collectChunkInvariantViolations } from './invariant.ts'

// 하위 함수 re-export (UI/테스트가 개별 접근 가능)
export { refineMarkdown } from './refine.ts'
export type { CleanPiece, CleanBlockEx } from './refine.ts'
export { chunkify } from './chunk.ts'
export { normalizeForCompare, assertChunkInvariant, collectChunkInvariantViolations } from './invariant.ts'

/**
 * 정제·청크·발음 로직의 버전. chunks 산출에 영향 주는 로직(발음 규칙·청크 분할·운율)을
 * 바꿀 때마다 +1 한다. StoredDocument.refineVersion 과 비교해, 코드가 업데이트되면
 * IndexedDB 에 캐시된 옛 chunks 를 버리고 자동 재정제한다(App.svelte openDocument).
 *
 * 이력: 1 = 발음(숫자·날짜·분수·차원 등) + 표 header/annotation + 운율(끊어읽기·강조 속도강조).
 */
export const REFINE_VERSION = 1

/**
 * 원문 마크다운을 정제·청크·검증까지 끝낸 결과를 반환한다.
 * @param rawText 원문(.md/.txt 내용)
 * @param opts.refine 정제 옵션(기본 DEFAULT_REFINE_OPTIONS)
 * @param opts.chunk 청크 옵션(기본 DEFAULT_CHUNK_OPTIONS)
 * @param opts.strict 불변식 위반 처리 방식(기본 false).
 *   - false(프로덕션 기본): 위반 시 throw 하지 않고 console.warn(위반 요약)만 남기고 청크를 그대로 반환.
 *     → 개발용 검출이 실제 사용자 문서에서 앱 전체를 정지시키는 일을 막는다(graceful degradation).
 *     북마크/하이라이트가 일부 어긋날 수는 있어도 앱은 살아남아 흘려듣기가 가능하다.
 *   - true(개발·테스트): 위반 시 즉시 throw(invariant.check.ts 등에서 매핑 회귀 검출용).
 * @returns { blocks, chunks } — blocks 는 CleanBlock(+pieces), chunks 는 Chunk[]
 * @throws strict=true 이고 불변식 위반 시 Error(상세 메시지).
 */
export function buildChunks(
  rawText: string,
  opts?: { refine?: RefineOptions; chunk?: ChunkOptions; strict?: boolean },
): { blocks: CleanBlock[]; chunks: Chunk[] } {
  const refineOpts = opts?.refine ?? DEFAULT_REFINE_OPTIONS
  const chunkOpts = opts?.chunk ?? DEFAULT_CHUNK_OPTIONS
  const strict = opts?.strict ?? false

  const blocks = refineMarkdown(rawText, refineOpts)
  const chunks = chunkify(blocks, rawText, chunkOpts, refineOpts)

  if (strict) {
    // 개발/테스트: 매핑이 깨지면 즉시 실패시켜 회귀를 검출.
    assertChunkInvariant(chunks, rawText)
  } else {
    // 프로덕션: 위반이 있어도 앱을 죽이지 않는다. 경고만 남기고 청크는 그대로 반환.
    const violations = collectChunkInvariantViolations(chunks, rawText)
    if (violations.length > 0) {
      // 콘솔 폭주를 막기 위해 요약 + 앞 3건 상세만.
      console.warn(
        `[markdown-radio] 청크 불변식 위반 ${violations.length}건(graceful: 청크는 그대로 사용). ` +
          `북마크/하이라이트가 일부 어긋날 수 있습니다.\n` +
          violations.slice(0, 3).join('\n') +
          (violations.length > 3 ? `\n…외 ${violations.length - 3}건` : ''),
      )
    }
  }

  return { blocks, chunks }
}
