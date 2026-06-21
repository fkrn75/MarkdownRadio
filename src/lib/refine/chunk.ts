/**
 * FN-03 · 문장 청크 분할
 *
 * 정제 블록을 재생·합성·북마크의 최소 단위인 청크로 나눈다.
 * 핵심 불변식(MUST): 모든 speech 청크에 대해
 *   normalizeForCompare(rawText.slice(c.startOffset, c.endOffset)) === normalizeForCompare(c.text)
 *
 * 매핑 전략:
 *  정제 블록의 "조각(pieces)"으로 [정제텍스트 char 위치 → 원문 offset] 맵을 만든다.
 *  block.text 를 Intl.Segmenter('ko','sentence')로 문장 분리한 뒤,
 *  각 문장의 [cleanStart, cleanEnd) 를 맵으로 되짚어 원문 [srcStart, srcEnd) 를 복원한다.
 *  (한 문장이 여러 조각에 걸치면 첫 조각 start ~ 마지막 조각 end 로 잡힘 → 불변식 성립)
 */
import type { CleanBlock, Chunk, ChunkOptions, RefineOptions } from '../types.ts'
import { DEFAULT_CHUNK_OPTIONS, DEFAULT_REFINE_OPTIONS } from '../types.ts'
import { refineMarkdown, type CleanBlockEx, type CleanPiece } from './refine.ts'

// ─────────────────────────────────────────────────────────────
// 조각 확보 (CleanBlockEx 면 그대로, 아니면 rawText 재정제로 매칭 복원)
// ─────────────────────────────────────────────────────────────

function hasPieces(b: CleanBlock): b is CleanBlockEx {
  return Array.isArray((b as CleanBlockEx).pieces) && (b as CleanBlockEx).pieces.length > 0
}

/**
 * blocks 가 plain CleanBlock[](pieces 없음)일 때, rawText 를 같은 옵션으로 재정제해
 * offset 으로 매칭하여 pieces 를 보강한다. (buildChunks 경유면 보통 이 경로를 타지 않는다.)
 */
function ensurePieces(blocks: CleanBlock[], rawText: string, refineOpts: RefineOptions): CleanBlockEx[] {
  if (blocks.every(hasPieces)) return blocks as CleanBlockEx[]
  const reref = refineMarkdown(rawText, refineOpts) as CleanBlockEx[]
  // startOffset 기준 매칭(동일 입력·옵션이면 1:1 일치).
  const byStart = new Map<number, CleanBlockEx>()
  for (const r of reref) byStart.set(r.startOffset, r)
  return blocks.map((b) => {
    if (hasPieces(b)) return b
    const match = byStart.get(b.startOffset)
    if (match) return match
    // 폴백: 단일 조각(텍스트=정제본, 원문범위=블록범위). 정규화 비교라 동치 가능성 높음.
    return {
      ...b,
      pieces: [{ plain: b.text, srcStart: b.startOffset, srcEnd: b.endOffset }],
    }
  })
}

// ─────────────────────────────────────────────────────────────
// 정제텍스트 char → 원문 offset 매핑
// ─────────────────────────────────────────────────────────────

/**
 * 블록의 조각들로부터 정제텍스트 각 문자 위치에 대응하는 원문 offset 배열을 만든다.
 * startMap[i] = 정제텍스트 i번째 문자의 원문 시작 offset
 * endMap[i]   = 정제텍스트 i번째 문자의 원문 끝 offset(exclusive)
 * 한 조각 내부에서는 plain 길이에 맞춰 [srcStart..srcEnd] 를 선형 보간한다.
 */
interface OffsetMap {
  text: string
  startMap: number[] // 길이 = text.length, i번째 문자의 원문 시작 offset
  endMap: number[] // 길이 = text.length, i번째 문자의 원문 끝 offset(exclusive)
  /**
   * gapBefore[i] = 정제텍스트 (i-1)번째와 i번째 문자 "사이"에 원문에서 버려진(정제가 제거한)
   * 내용의 길이. 단순 공백 한두 칸이 아니라 이미지/각주/URL 등 실제 내용이 빠진 자리를 뜻한다.
   * 한 청크가 이 큰 gap 을 가로지르면, 그 청크의 slice 는 버려진 내용을 포함하게 되어
   * 불변식(정규화 비교)이 깨질 수 있으므로 청크를 그 지점에서 쪼갠다.
   */
  gapBefore: number[] // 길이 = text.length
}

function buildOffsetMap(pieces: CleanPiece[]): OffsetMap {
  let text = ''
  const startMap: number[] = []
  const endMap: number[] = []
  const gapBefore: number[] = []
  let prevSrcEnd: number | null = null
  for (const p of pieces) {
    const n = p.plain.length
    if (n === 0) continue
    const span = p.srcEnd - p.srcStart
    for (let i = 0; i < n; i++) {
      // 조각 내 i번째 문자의 원문 위치를 선형 보간(정수).
      const s = p.srcStart + Math.floor((span * i) / n)
      const e = p.srcStart + Math.floor((span * (i + 1)) / n)
      startMap.push(s)
      endMap.push(Math.max(e, s)) // 최소 s 보장
      // 조각의 첫 문자 앞에는, 직전 조각 끝~이번 조각 시작 사이의 원문 gap 이 존재할 수 있다.
      if (i === 0) {
        const gap = prevSrcEnd == null ? 0 : Math.max(0, p.srcStart - prevSrcEnd)
        gapBefore.push(gap)
      } else {
        gapBefore.push(0)
      }
    }
    text += p.plain
    prevSrcEnd = p.srcEnd
  }
  return { text, startMap, endMap, gapBefore }
}

/**
 * gap 임계값: 이보다 큰 원문 gap 은 "버려진 실제 내용"으로 보고 청크 경계로 삼는다.
 * 공백 1~2칸(마커 제거로 생기는 좁은 틈)은 무시한다.
 */
const GAP_BREAK_THRESHOLD = 3

/**
 * 짧은 청크 병합 허용 최대 gap(원문 문자수). 이보다 사이가 벌어지면(=버려진/건너뛴 내용이
 * 끼면) 병합하지 않는다. 같은/이웃 문단의 좁은 틈(문장 사이 ". ", 문단 사이 "\n\n",
 * 리스트마커 "- "/"1. ", 인용마커 "> " 정도)만 허용하고, 코드블록·표·구분선처럼
 * 정규화로 환원되지 않는 큰 덩어리(또는 그 펜스/구분 문자)는 막아 불변식을 지킨다.
 */
const MERGE_MAX_GAP = 3

/**
 * 문장 [start,end) 를, 내부에 큰 원문 gap 이 있으면 그 지점에서 더 잘게 쪼갠다.
 * (예: 기본 모드에서 문장 중간 이미지가 제거되어 생긴 자리)
 */
function splitAtGaps(
  start: number,
  end: number,
  gapBefore: number[],
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  let segStart = start
  for (let i = start + 1; i < end; i++) {
    if (gapBefore[i] >= GAP_BREAK_THRESHOLD) {
      out.push({ start: segStart, end: i })
      segStart = i
    }
  }
  out.push({ start: segStart, end })
  return out
}

// ─────────────────────────────────────────────────────────────
// 문장 분리 + 길이 보정
// ─────────────────────────────────────────────────────────────

let _segmenter: Intl.Segmenter | null = null
function getSegmenter(): Intl.Segmenter | null {
  if (_segmenter) return _segmenter
  // 일부 환경에 Intl.Segmenter 가 없을 수 있으니 가드.
  const IntlAny = Intl as unknown as { Segmenter?: typeof Intl.Segmenter }
  if (typeof IntlAny.Segmenter !== 'function') return null
  _segmenter = new IntlAny.Segmenter('ko', { granularity: 'sentence' })
  return _segmenter
}

/** 정제텍스트를 문장 경계 [start,end) 들로 분리. Segmenter 없으면 정규식 폴백. */
function segmentSentences(text: string): Array<{ start: number; end: number }> {
  const seg = getSegmenter()
  const out: Array<{ start: number; end: number }> = []
  if (seg) {
    for (const s of seg.segment(text)) {
      const start = s.index
      const end = s.index + s.segment.length
      if (end > start) out.push({ start, end })
    }
    return out
  }
  // 폴백: 종결부호(.!?。…) + 공백 기준. 약어 보호는 best-effort 불가.
  const re = /[^.!?。…\n]*[.!?。…]+[)\]"'」』]*\s*|[^.!?。…\n]+$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = m.index
    const end = m.index + m[0].length
    if (end > start) out.push({ start, end })
    if (m.index === re.lastIndex) re.lastIndex++ // 무한루프 가드
  }
  if (out.length === 0 && text.length > 0) out.push({ start: 0, end: text.length })
  return out
}

/**
 * maxChars 초과 문장을 쉼표/접속사/공백에서 강제 분할.
 * 사유: 합성 지연·메모리 + Chrome speechSynthesis 15초 침묵 버그(긴 발화 중단) 회피.
 * 반환: 원래 [start,end) 를 더 작은 [start,end) 들로 쪼갠 배열.
 */
function splitLong(
  text: string,
  start: number,
  end: number,
  maxChars: number,
): Array<{ start: number; end: number }> {
  if (end - start <= maxChars) return [{ start, end }]
  const out: Array<{ start: number; end: number }> = []
  let cur = start
  while (end - cur > maxChars) {
    const window = text.slice(cur, cur + maxChars)
    // 분할 우선순위: 쉼표류 > 접속사 앞 공백 > 마지막 공백 > 하드 컷
    let cut = findLastBreak(window)
    if (cut <= 0) cut = maxChars // 마땅한 분할점 없으면 하드 컷
    const abs = cur + cut
    out.push({ start: cur, end: abs })
    cur = abs
  }
  if (cur < end) out.push({ start: cur, end })
  return out
}

/** 윈도우 문자열 안에서 가장 뒤쪽의 자연스러운 분할 지점(상대 인덱스, exclusive)을 찾는다. */
function findLastBreak(window: string): number {
  // 쉼표·중점·세미콜론 등 뒤(그 다음 위치까지 포함)
  const punct = /[,，、;；·]/g
  let last = -1
  let m: RegExpExecArray | null
  while ((m = punct.exec(window)) !== null) last = m.index + 1
  if (last > 0) {
    // 분할점 뒤 공백은 다음 청크 앞에 두지 않도록 흡수
    let p = last
    while (p < window.length && window[p] === ' ') p++
    return p
  }
  // 한국어 접속사 앞 공백
  const conj = /\s(그리고|그러나|하지만|또는|그래서|그러므로|따라서|그런데|또한|즉)\b/g
  last = -1
  while ((m = conj.exec(window)) !== null) last = m.index // 접속사 앞 공백 위치에서 끊음
  if (last > 0) return last + 1 // 공백 다음(접속사부터 다음 청크)
  // 마지막 공백
  const lastSpace = window.lastIndexOf(' ')
  if (lastSpace > 0) return lastSpace + 1
  return -1
}

// ─────────────────────────────────────────────────────────────
// public API
// ─────────────────────────────────────────────────────────────

/**
 * 정제 블록 배열을 청크 배열로 변환한다.
 * @param blocks refineMarkdown 결과(CleanBlockEx 권장 — pieces 포함 시 재정제 없이 동작)
 * @param rawText 원문(블록에 pieces 가 없을 때 재정제 매칭에 사용)
 */
export function chunkify(
  blocks: CleanBlock[],
  rawText: string,
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
  refineOpts: RefineOptions = DEFAULT_REFINE_OPTIONS,
): Chunk[] {
  const exBlocks = ensurePieces(blocks, rawText, refineOpts)

  // 1) 블록별로 문장 → (원문 범위, 텍스트) 후보를 만든다. 무음 마커도 자리표시.
  type Cand =
    | { kind: 'speech'; text: string; startOffset: number; endOffset: number; isHeading: boolean }
    | { kind: 'silence' }

  const cands: Cand[] = []

  for (const block of exBlocks) {
    const map = buildOffsetMap(block.pieces)
    const cleanText = map.text
    if (cleanText.trim() === '') {
      // 헤더이면서 무음 옵션이면 헤더 자체는 아래에서 다뤄짐 — 여기선 skip
      continue
    }

    // 문장 분리 → 큰 gap(버려진 내용) 경계 분할 → 길이 보정
    const sentences: Array<{ start: number; end: number }> = []
    for (const s of segmentSentences(cleanText)) {
      for (const g of splitAtGaps(s.start, s.end, map.gapBefore)) {
        for (const piece of splitLong(cleanText, g.start, g.end, opts.maxChars)) {
          sentences.push(piece)
        }
      }
    }
    if (sentences.length === 0) sentences.push({ start: 0, end: cleanText.length })

    for (const s of sentences) {
      // 앞뒤 공백을 텍스트에선 trim 하되, 원문 offset 은 trim 된 실제 문자에 맞춘다.
      let cs = s.start
      let ce = s.end
      while (cs < ce && /\s/.test(cleanText[cs])) cs++
      while (ce > cs && /\s/.test(cleanText[ce - 1])) ce--
      if (ce <= cs) continue
      const text = cleanText.slice(cs, ce)
      const startOffset = map.startMap[cs]
      const endOffset = map.endMap[ce - 1]
      cands.push({
        kind: 'speech',
        text,
        startOffset,
        endOffset,
        isHeading: block.isHeading,
      })
    }

    // 헤더 뒤 무음 청크 삽입(옵션).
    if (opts.silenceAfterHeading && block.isHeading) {
      cands.push({ kind: 'silence' })
    }
  }

  // 2) 너무 짧은 speech 청크 병합(헤더는 단독 유지 가능). silence 는 경계로 취급.
  //    ⚠️ 핵심: 병합은 두 청크가 원문에서 "거의 붙어 있을 때만"(prev.end ~ cur.start gap 이
  //    작을 때만) 한다. 사이에 버려진 내용(코드블록·각주 등)이 끼어 gap 이 크면, 병합하면
  //    합쳐진 청크의 slice 가 그 버려진 내용을 포함해 불변식이 깨진다 → 그 경우 병합하지 않는다.
  const merged: Cand[] = []
  for (const c of cands) {
    if (c.kind === 'silence') {
      merged.push(c)
      continue
    }
    const prev = merged.length > 0 ? merged[merged.length - 1] : null
    const tooShort = c.text.length < opts.minChars
    const gap = prev && prev.kind === 'speech' ? c.startOffset - prev.endOffset : Infinity
    if (
      tooShort &&
      !c.isHeading &&
      prev &&
      prev.kind === 'speech' &&
      !prev.isHeading &&
      c.startOffset >= prev.endOffset &&
      // 사이 gap 이 작을 때만(공백·마커 정도). 큰 gap = 버려진 내용 → 병합 금지.
      gap <= MERGE_MAX_GAP
    ) {
      // 이전 speech 와 병합: 텍스트는 공백으로 잇고, 원문 범위는 [prev.start, c.end] 로 확장.
      prev.text = (prev.text + ' ' + c.text).replace(/\s+/g, ' ').trim()
      prev.endOffset = Math.max(prev.endOffset, c.endOffset)
    } else {
      merged.push(c)
    }
  }

  // 3) 인덱스 부여 + Chunk 생성. silence 는 헤더 무음.
  const chunks: Chunk[] = []
  let index = 0
  for (const c of merged) {
    if (c.kind === 'silence') {
      chunks.push({
        index: index++,
        text: '',
        startOffset: 0,
        endOffset: 0,
        kind: 'silence',
        silenceMs: opts.headingSilenceMs,
      })
    } else {
      chunks.push({
        index: index++,
        text: c.text,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        kind: 'speech',
        isHeading: c.isHeading || undefined,
      })
    }
  }

  return chunks
}
