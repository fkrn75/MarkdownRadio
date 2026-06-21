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
import { assertChunkInvariant } from './invariant.ts'

// 하위 함수 re-export (UI/테스트가 개별 접근 가능)
export { refineMarkdown } from './refine.ts'
export type { CleanPiece, CleanBlockEx } from './refine.ts'
export { chunkify } from './chunk.ts'
export { normalizeForCompare, assertChunkInvariant } from './invariant.ts'

/**
 * 원문 마크다운을 정제·청크·검증까지 끝낸 결과를 반환한다.
 * @param rawText 원문(.md/.txt 내용)
 * @param opts.refine 정제 옵션(기본 DEFAULT_REFINE_OPTIONS)
 * @param opts.chunk 청크 옵션(기본 DEFAULT_CHUNK_OPTIONS)
 * @returns { blocks, chunks } — blocks 는 CleanBlock(+pieces), chunks 는 불변식 보장된 Chunk[]
 * @throws 불변식 위반 시 Error(상세 메시지). 매핑이 깨진 결과를 UI 로 내보내지 않기 위함.
 */
export function buildChunks(
  rawText: string,
  opts?: { refine?: RefineOptions; chunk?: ChunkOptions },
): { blocks: CleanBlock[]; chunks: Chunk[] } {
  const refineOpts = opts?.refine ?? DEFAULT_REFINE_OPTIONS
  const chunkOpts = opts?.chunk ?? DEFAULT_CHUNK_OPTIONS

  const blocks = refineMarkdown(rawText, refineOpts)
  const chunks = chunkify(blocks, rawText, chunkOpts, refineOpts)
  // 빌드타임/런타임 양쪽 강제: 매핑이 깨지면 즉시 실패시켜 북마크·하이라이트 오정렬을 사전 차단.
  assertChunkInvariant(chunks, rawText)

  return { blocks, chunks }
}
