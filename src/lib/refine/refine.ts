/**
 * FN-02 · 마크다운 정제 엔진 (제품의 해자 = 핵심 차별점)
 *
 * 마크다운을 TTS가 자연스럽게 읽을 평문으로 변환하되, 원문 문자 오프셋을 절대 잃지 않는다.
 * remark(mdast)로 파싱 후 각 노드의 position.start/end.offset 으로 원문을 slice 해 평문을 만든다.
 * (mdast-util-to-string 처럼 오프셋을 잃는 변환은 금지 — 원문↔재생↔북마크 매핑이 깨진다.)
 *
 * 설계의 핵심 = "조각(Piece)" 단위:
 *   각 인라인 조각은 { plain, srcStart, srcEnd } 로, 마커가 제거된 평문(plain)과
 *   그 평문이 유래한 원문 문자 범위(srcStart..srcEnd)를 함께 들고 다닌다.
 *   블록의 text = 조각들의 plain 을 이어붙인 것, 블록의 offset = [첫 조각.srcStart, 마지막 조각.srcEnd].
 *   이 조각 배열은 chunk.ts 가 문장→원문오프셋 매핑을 만드는 토대가 되므로 그대로 노출한다.
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root, RootContent, PhrasingContent } from 'mdast'
import type { CleanBlock, RefineOptions } from '../types.ts'
import { DEFAULT_REFINE_OPTIONS } from '../types.ts'

/**
 * 정제된 평문 조각. 한 조각의 plain 은 마커가 제거된 텍스트이고,
 * srcStart..srcEnd 는 그 텍스트가 유래한 "원문" 문자 범위(exclusive end)다.
 * 한 문장이 여러 조각(예: 중간에 **굵게**)으로 쪼개질 때, 청크 단계에서
 * 첫 조각의 srcStart ~ 마지막 조각의 srcEnd 로 원문 범위를 복원한다.
 *
 * isEmphasis: strong/emphasis 노드에서 유래한 조각임을 표시.
 *   plain/srcStart/srcEnd 는 절대 바꾸지 않는다(오프셋 불변식 무손상).
 *   바깥 강조 노드 우선: 이미 태깅된 조각은 덮어쓰지 않는다.
 */
export interface CleanPiece {
  plain: string
  srcStart: number
  srcEnd: number
  /** strong(**굵게**) / emphasis(*기울임*) 노드에서 유래. delete(취소선)는 제외. */
  isEmphasis?: 'strong' | 'emphasis'
}

/**
 * 블록 내 강조 구간(block.text 정제텍스트 char 인덱스 기준).
 * start: inclusive, end: exclusive.
 * ⚠️ 원문 오프셋(srcStart/srcEnd)이 아님 — blockFromPieces 가 charCursor 로 계산.
 */
export interface EmphasisRange {
  start: number
  end: number
  kind: 'strong' | 'emphasis'
}

/** 내부 확장 블록: CleanBlock + 조각 배열(청크 매핑용). chunkify 가 사용한다. */
export interface CleanBlockEx extends CleanBlock {
  /** 이 블록을 구성하는 평문 조각들(원문 오프셋 보존). text 는 이들의 plain 연결과 동일. */
  pieces: CleanPiece[]
  /**
   * 블록 내 강조 구간 목록(정제텍스트 char 인덱스 기준).
   * chunk.ts 가 sentence 교차 계산 후 chunk.rateScale 결정에 사용.
   * 없으면(강조 없음) undefined.
   */
  emphasisRanges?: EmphasisRange[]
}

// ─────────────────────────────────────────────────────────────
// 작은 유틸
// ─────────────────────────────────────────────────────────────

/** 노드의 원문 오프셋 쌍을 안전하게 얻는다(없으면 null). */
function nodeOffsets(node: { position?: { start: { offset?: number }; end: { offset?: number } } }):
  | { start: number; end: number }
  | null {
  const p = node.position
  if (!p || p.start.offset == null || p.end.offset == null) return null
  return { start: p.start.offset, end: p.end.offset }
}

/** 이모지·이형문자(variation selector) 제거. 텍스트 평문에만 적용. */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu

function stripEmoji(s: string): string {
  return s.replace(EMOJI_RE, '')
}

/**
 * 다이어그램 코드블록 언어 집합. 이 언어로 표기된 펜스 코드블록은 내용을 읽으면 소음이므로
 * "도표가 있습니다" 안내(annotation 블록)로 치환해 흘려듣기→정독 복귀를 돕는다.
 */
const DIAGRAM_LANGS = new Set([
  'mermaid',
  'plantuml',
  'puml',
  'dot',
  'graphviz',
  'sequence',
  'flowchart',
  'gantt',
  'classdiagram',
  'statediagram',
  'erdiagram',
])

/**
 * ⚠️ 이모지 오프셋 정합(FN-02 · B.1): 단순 stripEmoji 는 plain 만 줄이고 원문 범위는 그대로 둬서,
 *   buildOffsetMap 의 선형보간이 첫 평문 문자를 이모지(서로게이트 페어, UTF-16 2 code unit) 한복판/
 *   바로 뒤로 매핑 → slice 가 깨진 low-surrogate(\udexx)나 이모지를 포함해 불변식이 깨졌다.
 *
 * 해결: 텍스트 노드 value(원문 그대로, 1:1 오프셋)를 이모지 경계로 쪼개,
 *   살아남은 각 평문 런(run)을 자기 원문 범위 [baseOffset+runStart, baseOffset+runEnd] 를 가진
 *   별도 조각으로 만든다. 제거된 이모지는 조각 사이의 "진짜 gap"이 되어,
 *   문장 시작 offset 이 자연히 이모지(그리고 뒤따르는 공백, trim 단계가 처리)를 건너뛴다.
 *
 * 전제: text 노드의 value 는 (이모지 외엔) 원문과 거의 1:1 이지만 ⚠️ 완전하진 않다 —
 *   백슬래시 이스케이프(`\*` `\_` 등)는 remark 가 같은 text 노드 value 에 백슬래시를 "뺀"
 *   형태로 담는다(value.length < 원문 폭). 따라서 value.length 를 원문 끝 offset 으로 쓰면
 *   누락된 백슬래시 수만큼 끝 글자가 slice 범위 밖으로 밀려난다.
 *   → 마지막 평문 런의 srcEnd 는 value.length 가 아니라 노드 실제 끝(nodeEnd)으로 잡아 흡수한다.
 *     (plain 길이 ≠ 범위 폭이어도 무방 — 불변식은 정규화 후 비교한다.)
 */
function pushEmojiAwarePieces(
  value: string,
  baseOffset: number,
  nodeEnd: number,
  out: CleanPiece[],
): void {
  EMOJI_RE.lastIndex = 0
  let runStart = 0 // 현재 평문 런의 value 내 시작 인덱스
  let m: RegExpExecArray | null
  while ((m = EMOJI_RE.exec(value)) !== null) {
    const emojiStart = m.index
    const emojiEnd = m.index + m[0].length
    if (emojiStart > runStart) {
      // 이모지 직전까지의 평문 런을 자기 원문 범위로 push.
      const run = value.slice(runStart, emojiStart)
      const p = piece(run, baseOffset + runStart, baseOffset + emojiStart)
      if (p) out.push(p)
    }
    runStart = emojiEnd // 이모지는 건너뛴다(gap).
    if (m.index === EMOJI_RE.lastIndex) EMOJI_RE.lastIndex++ // 0폭 매치 무한루프 가드
  }
  // 마지막 이모지 뒤(또는 이모지가 없으면 전체) 평문 런.
  //  srcEnd 는 노드 실제 끝(nodeEnd)으로 — 백슬래시 이스케이프로 줄어든 value.length 차이를 흡수.
  //  (이스케이프가 없으면 baseOffset+value.length == nodeEnd 라 기존 동작과 동일 → 회귀 없음.)
  if (runStart < value.length) {
    const run = value.slice(runStart)
    const p = piece(run, baseOffset + runStart, nodeEnd)
    if (p) out.push(p)
  }
}

/** HTML 태그 제거(인라인/블록 HTML 노드 본문 정리용). */
function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]*>/g, '')
}

/**
 * 평문 텍스트 조각을 만든다. 원문 범위는 그대로 보존하되 plain 만 정리.
 * 주의: plain 길이가 (srcEnd-srcStart)와 달라도 무방하다 — 불변식은 정규화 후 비교한다.
 */
function piece(plain: string, srcStart: number, srcEnd: number): CleanPiece | null {
  if (srcEnd < srcStart) return null
  return { plain, srcStart, srcEnd }
}

/** URL 문자열인지(autolink/원문 URL 판별용). */
function looksLikeUrl(s: string): boolean {
  return /^(https?:\/\/|www\.|mailto:)/i.test(s.trim())
}

// ─────────────────────────────────────────────────────────────
// 인라인(phrasing) 처리 — 조각 수집
// ─────────────────────────────────────────────────────────────

/**
 * phrasing 노드 하나를 평문 조각들로 변환해 out 에 push.
 * - text: 그대로(이모지/HTML 정리)
 * - strong/emphasis/delete: 마커 제거 → 자식 평문만(원문 범위는 자식 노드 offset 사용)
 * - inlineCode: 내용 유지(코드 백틱 제거)
 * - link: autolink/원문 URL 이면 "링크" 치환, 아니면 링크 텍스트만(URL 제거)
 * - image: opts.readImageAlt 면 alt 만, 아니면 제거
 * - break: 공백으로
 * - footnoteReference / html: 제거
 */
function collectPhrasing(node: PhrasingContent, opts: RefineOptions, out: CleanPiece[]): void {
  switch (node.type) {
    case 'text': {
      const off = nodeOffsets(node)
      if (!off) return
      // 이모지를 단순 제거하지 않고 경계로 쪼개 각 평문 런이 정확한 원문 범위를 갖게 한다(B.1).
      //  off.end 를 넘겨 마지막 런이 백슬래시 이스케이프로 줄어든 폭을 노드 끝까지 흡수하게 한다.
      pushEmojiAwarePieces(node.value, off.start, off.end, out)
      return
    }
    case 'inlineCode': {
      // 인라인 코드: 내용(식별자 등) 유지. 백틱은 원문에만 있고 plain 에는 value 만.
      const off = nodeOffsets(node)
      if (!off) return
      const p = piece(node.value, off.start, off.end)
      if (p) out.push(p)
      return
    }
    case 'strong':
    case 'emphasis': {
      // 마커 제거: 자식들을 그대로 평문화(각 자식의 원문 offset 보존).
      // 재귀 전후 out.length 를 비교해 이 강조 노드에서 유래한 조각을 특정하고 isEmphasis 태깅.
      // ⚠️ 바깥 강조 노드 우선: 이미 isEmphasis 가 설정된 조각은 덮어쓰지 않는다(중첩 시).
      const kind = node.type as 'strong' | 'emphasis'
      const before = out.length
      for (const child of node.children) collectPhrasing(child, opts, out)
      for (let i = before; i < out.length; i++) {
        if (!out[i].isEmphasis) out[i] = { ...out[i], isEmphasis: kind }
      }
      return
    }
    case 'delete': {
      // 취소선: 강조 의미 없음 — 마커만 제거하고 isEmphasis 태깅 안 함.
      for (const child of node.children) collectPhrasing(child, opts, out)
      return
    }
    case 'link': {
      const off = nodeOffsets(node)
      if (!off) return
      // 링크 텍스트 평문 수집(자식 기준).
      const inner: CleanPiece[] = []
      for (const child of node.children) collectPhrasing(child, opts, inner)
      const innerText = inner.map((x) => x.plain).join('')
      // autolink / bare URL: 표시 텍스트가 비었거나 그 자체가 URL 일 때만 "링크" 치환(FN-02).
      //  ⚠️ B.3: 예전엔 표시텍스트===url 이면 autolink 로 봤는데, [a.md](a.md) 처럼
      //   링크 텍스트가 URL 과 우연히 같은(.md 상호참조 등) [text](url) 구조까지 "링크"로 잘못 치환돼
      //   slice(원문 [text](url))=normalize→text 와 어긋났다. 구조가 [text](url) 면 무조건 text 를 쓴다.
      //   "링크" 치환은 bare URL(autolink literal: 표시텍스트가 URL 자신) 에만 적용.
      const isAutolink = innerText.trim() === '' || looksLikeUrl(innerText)
      if (isAutolink) {
        // 링크 전체 원문 범위를 "링크" 한 단어로 치환.
        const p = piece('링크', off.start, off.end)
        if (p) out.push(p)
      } else {
        // 일반 링크: 표시 텍스트만 읽되, 원문 범위는 링크 노드 "전체"([text](url))로 둔다.
        // 이러면 이 조각을 포함한 청크 slice 에 완전한 [text](url) 구문이 들어와,
        // normalizeForCompare 가 [text](url)→text 로 환원해 불변식이 성립한다.
        // (자식 조각 offset 만 쓰면 청크가 ](url) 같은 구문 일부를 가로질러 깨진다.)
        const p = piece(innerText, off.start, off.end)
        if (p) out.push(p)
      }
      return
    }
    case 'linkReference': {
      // 참조형 링크([text][id]/[text]): 표시 텍스트만, 원문 범위는 노드 전체로.
      const off = nodeOffsets(node)
      const inner: CleanPiece[] = []
      for (const child of node.children) collectPhrasing(child, opts, inner)
      const innerText = inner.map((x) => x.plain).join('')
      if (off && innerText) {
        const p = piece(innerText, off.start, off.end)
        if (p) out.push(p)
      }
      return
    }
    case 'image':
    case 'imageReference': {
      if (opts.readImageAlt) {
        const off = nodeOffsets(node)
        const alt = (node as { alt?: string }).alt ?? ''
        const cleanAlt = stripEmoji(alt).trim()
        if (off && cleanAlt) {
          // alt 조각의 원문 범위는 image 노드 "전체"(![alt](url))로 둔다.
          // 이러면 이 조각을 포함한 청크의 slice 에 완전한 ![...](...) 구문이 들어오고,
          // normalizeForCompare 가 ![alt](url)→alt 로 환원하므로 text(="alt")와 일치한다.
          const p = piece(cleanAlt, off.start, off.end)
          if (p) out.push(p)
        }
      }
      // 기본: 이미지 제거(아무 것도 push 안 함).
      return
    }
    case 'break': {
      const off = nodeOffsets(node)
      if (off) {
        const p = piece(' ', off.start, off.end)
        if (p) out.push(p)
      }
      return
    }
    case 'footnoteReference': {
      // 각주 참조 제거.
      return
    }
    case 'html': {
      // 인라인 HTML 태그 제거. 태그 사이 텍스트가 있으면 살린다.
      const off = nodeOffsets(node)
      if (!off) return
      const plain = stripEmoji(stripHtmlTags(node.value))
      if (plain.trim()) {
        const p = piece(plain, off.start, off.end)
        if (p) out.push(p)
      }
      return
    }
    default: {
      // 알 수 없는 phrasing: 자식이 있으면 재귀, 없으면 무시.
      const anyNode = node as { children?: PhrasingContent[] }
      if (Array.isArray(anyNode.children)) {
        for (const child of anyNode.children) collectPhrasing(child, opts, out)
      }
      return
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 블록 생성 헬퍼
// ─────────────────────────────────────────────────────────────

/** 0-based 행 번호 계산용: 오프셋 → 행. position.start.line 이 1-based 이므로 -1. */
function blockFromPieces(
  pieces: CleanPiece[],
  isHeading: boolean,
  headingLevel: number | undefined,
  lineStart: number,
  lineEnd: number,
): CleanBlockEx | null {
  // 빈 조각 제거(앞뒤 공백만 있는 것 포함은 유지: 문장 사이 공백 보존 위해 plain 자체는 보존)
  const usable = pieces.filter((p) => p.plain.length > 0)
  if (usable.length === 0) return null
  const text = usable.map((p) => p.plain).join('')
  if (text.trim() === '') return null
  const startOffset = usable[0].srcStart
  const endOffset = usable[usable.length - 1].srcEnd

  // ── 강조 구간(emphasisRanges) 계산 ──────────────────────────
  // pieces 를 순회하며 정제텍스트 내 char 인덱스(charCursor)를 추적.
  // isEmphasis 가 설정된 연속 조각들을 같은 kind 끼리 하나의 EmphasisRange 로 병합.
  // ⚠️ 좌표계: block.text(정제텍스트) 내 char 인덱스 — 원문 오프셋이 아님.
  const emphasisRanges: EmphasisRange[] = []
  let charCursor = 0
  let emphStart: number | null = null
  let emphKind: 'strong' | 'emphasis' | null = null
  for (const p of usable) {
    const len = p.plain.length
    const curKind = p.isEmphasis ?? null
    if (curKind !== null) {
      if (emphStart === null || curKind !== emphKind) {
        // 이전 range 확정(kind 가 달라졌으면 닫고 새로)
        if (emphStart !== null && emphKind !== null) {
          emphasisRanges.push({ start: emphStart, end: charCursor, kind: emphKind })
        }
        emphStart = charCursor
        emphKind = curKind
      }
      // 같은 kind 연속: emphStart 유지, 아직 닫지 않음.
    } else {
      // 강조 끝 — 열린 range 닫기
      if (emphStart !== null && emphKind !== null) {
        emphasisRanges.push({ start: emphStart, end: charCursor, kind: emphKind })
        emphStart = null
        emphKind = null
      }
    }
    charCursor += len
  }
  // 마지막 조각까지 강조가 이어진 경우 닫기
  if (emphStart !== null && emphKind !== null) {
    emphasisRanges.push({ start: emphStart, end: charCursor, kind: emphKind })
  }

  return {
    text,
    isHeading,
    headingLevel,
    sourceLineStart: lineStart,
    sourceLineEnd: lineEnd,
    startOffset,
    endOffset,
    pieces: usable,
    ...(emphasisRanges.length > 0 ? { emphasisRanges } : {}),
  }
}

function lineOf(node: { position?: { start: { line: number }; end: { line: number } } }): {
  start: number
  end: number
} {
  const p = node.position
  if (!p) return { start: 0, end: 0 }
  return { start: p.start.line - 1, end: p.end.line - 1 }
}

// ─────────────────────────────────────────────────────────────
// 블록(flow) 처리
// ─────────────────────────────────────────────────────────────

/**
 * value(코드/HTML 본문)가 노드 원문 범위 안에서 시작하는 실제 offset 을 찾는다.
 * 코드블록은 ```lang 펜스 뒤, HTML 은 태그 사이라 노드 시작과 value 시작이 다르다.
 * 못 찾으면 노드 시작 offset 으로 폴백.
 */
function locateValueOffset(rawText: string, nodeStart: number, nodeEnd: number, value: string): number {
  if (value.length === 0) return nodeStart
  const found = rawText.indexOf(value, nodeStart)
  if (found >= 0 && found < nodeEnd) return found
  return nodeStart
}

/** 한 flow 노드를 0개 이상의 CleanBlockEx 로 변환해 out 에 push. */
function collectFlow(node: RootContent, opts: RefineOptions, rawText: string, out: CleanBlockEx[]): void {
  const line = lineOf(node)
  switch (node.type) {
    case 'heading': {
      const pieces: CleanPiece[] = []
      for (const child of node.children) collectPhrasing(child, opts, pieces)
      const b = blockFromPieces(pieces, true, node.depth, line.start, line.end)
      if (b) out.push(b)
      return
    }
    case 'paragraph': {
      const pieces: CleanPiece[] = []
      for (const child of node.children) collectPhrasing(child, opts, pieces)
      const b = blockFromPieces(pieces, false, undefined, line.start, line.end)
      if (b) out.push(b)
      return
    }
    case 'blockquote': {
      // 인용 마커(>) 제거, 본문만. 내부 자식 flow 를 평탄화해 그대로 처리.
      for (const child of node.children) collectFlow(child, opts, rawText, out)
      return
    }
    case 'list': {
      // 리스트: 마커 제거, 각 항목을 개별 블록으로 평탄화(중첩 깊이 무시).
      for (const item of node.children) collectFlow(item, opts, rawText, out)
      return
    }
    case 'listItem': {
      // 항목: 내부 flow(문단·중첩리스트 등)를 평탄화.
      for (const child of node.children) collectFlow(child, opts, rawText, out)
      return
    }
    case 'code': {
      // 다이어그램 코드블록(mermaid 등): 읽으면 소음이므로 "도표 있음" 안내(annotation)로 치환.
      //   text='도표'(자막·하이라이트용), spokenText=안내문(발화), offset=원문 도표 범위.
      //   불변식은 annotation 을 동치 검사에서 제외하므로 안전.
      const codeOff = nodeOffsets(node)
      const codeLang = ((node as { lang?: string }).lang ?? '').toLowerCase()
      if (codeOff && DIAGRAM_LANGS.has(codeLang)) {
        out.push({
          text: '도표',
          isHeading: false,
          headingLevel: undefined,
          sourceLineStart: line.start,
          sourceLineEnd: line.end,
          startOffset: codeOff.start,
          endOffset: codeOff.end,
          pieces: [{ plain: '도표', srcStart: codeOff.start, srcEnd: codeOff.end }],
          isAnnotation: true,
          spokenText: '도표가 있습니다. 정독 화면에서 확인하세요.',
        })
        return
      }
      // 코드블록: 기본 건너뜀. opts.skipCodeBlocks=false 면 내용을 읽되,
      // 코드 자체는 문장 정제 대상이 아니므로 원문 그대로(언어 펜스 제외)를 한 블록으로.
      if (opts.skipCodeBlocks) return
      const off = nodeOffsets(node)
      if (!off) return
      const value = (node as { value?: string }).value ?? ''
      if (value.trim() === '') return
      // value 의 정확한 원문 위치(펜스 뒤)를 찾아 offset 을 잡는다.
      const vs = locateValueOffset(rawText, off.start, off.end, value)
      const p = piece(value, vs, vs + value.length)
      if (p) {
        out.push({
          text: value,
          isHeading: false,
          headingLevel: undefined,
          sourceLineStart: line.start,
          sourceLineEnd: line.end,
          startOffset: p.srcStart,
          endOffset: p.srcEnd,
          pieces: [p],
        })
      }
      return
    }
    case 'table': {
      if (opts.tableMode === 'skip') return
      // 'list' 모드: 각 행을 "셀, 셀, 셀" 한 블록으로.
      collectTableAsList(node, opts, out)
      return
    }
    case 'thematicBreak': {
      // 구분선 제거.
      return
    }
    case 'html': {
      // 블록 HTML: 태그 제거 후 텍스트 남으면 한 블록.
      const off = nodeOffsets(node)
      if (!off) return
      const rawValue = (node as { value?: string }).value ?? ''
      const plain = stripEmoji(stripHtmlTags(rawValue)).trim()
      if (plain) {
        // 태그 제거 후 텍스트의 실제 원문 위치를 찾아 offset 을 좁힌다(없으면 노드 범위).
        const vs = locateValueOffset(rawText, off.start, off.end, plain)
        const p = vs > off.start ? piece(plain, vs, vs + plain.length) : piece(plain, off.start, off.end)
        if (p)
          out.push({
            text: plain,
            isHeading: false,
            headingLevel: undefined,
            sourceLineStart: line.start,
            sourceLineEnd: line.end,
            startOffset: p.srcStart,
            endOffset: p.srcEnd,
            pieces: [p],
          })
      }
      return
    }
    case 'footnoteDefinition': {
      // 각주 정의: 청취 본문에서 제외(읽지 않는다).
      return
    }
    default: {
      // 그 외(thematicBreak 외 알 수 없는 컨테이너): 자식 flow 가 있으면 평탄화.
      const anyNode = node as { children?: RootContent[] }
      if (Array.isArray(anyNode.children)) {
        for (const child of anyNode.children) collectFlow(child, opts, rawText, out)
      }
      return
    }
  }
}

/** 표를 "셀, 셀, 셀" 블록들로 변환. 행 단위 한 블록. */
function collectTableAsList(
  table: Extract<RootContent, { type: 'table' }>,
  opts: RefineOptions,
  out: CleanBlockEx[],
): void {
  // 'header' 모드: 첫 행을 헤더 라벨로 삼아 본문 행을 "헤더는 값"으로 읽는다(2행 이상일 때만).
  if (opts.tableMode === 'header' && table.children.length >= 2) {
    collectTableAsHeader(table, opts, out)
    return
  }
  for (const row of table.children) {
    const cellPieces: CleanPiece[] = []
    const rowLine = lineOf(row)
    for (const cell of row.children) {
      const inner: CleanPiece[] = []
      for (const child of cell.children) collectPhrasing(child, opts, inner)
      const cellText = inner
        .map((x) => x.plain)
        .join('')
        .trim()
      if (cellText === '') continue
      const off = nodeOffsets(cell)
      if (!off) continue
      // 두 번째 이후 셀 앞에 ", " 구분(plain 에만, 원문 범위는 셀 범위 유지).
      if (cellPieces.length > 0) {
        const sep = piece(', ', off.start, off.start)
        if (sep) cellPieces.push(sep)
      }
      const p = piece(cellText, off.start, off.end)
      if (p) cellPieces.push(p)
    }
    const b = blockFromPieces(cellPieces, false, undefined, rowLine.start, rowLine.end)
    if (b) out.push(b)
  }
}

/** 한글 받침에 따라 '은/는' 조사를 고른다(한글 음절이 아니면 '는'). */
function josaEunNeun(word: string): string {
  if (!word) return '는'
  const code = word.charCodeAt(word.length - 1)
  if (code < 0xac00 || code > 0xd7a3) return '는' // 한글 음절 영역 밖
  return (code - 0xac00) % 28 !== 0 ? '은' : '는' // 종성(받침) 있으면 '은'
}

/**
 * 표 'header' 모드: 첫 행을 헤더 라벨로, 본문 행마다
 *   text       = "값1, 값2"          (원문 셀 piece 기반 → 불변식 유지)
 *   spokenText = "헤더1은 값1, 헤더2는 값2"  (청취 컨텍스트)
 * 로 만든다. spokenText 는 chunk.ts 가 1 청크로 보존한다(숫자 등은 toSpoken 이 추가 변환).
 */
function collectTableAsHeader(
  table: Extract<RootContent, { type: 'table' }>,
  opts: RefineOptions,
  out: CleanBlockEx[],
): void {
  const rows = table.children
  // 첫 행 = 헤더 셀 텍스트.
  const headerCells: string[] = []
  for (const cell of rows[0].children) {
    const inner: CleanPiece[] = []
    for (const child of cell.children) collectPhrasing(child, opts, inner)
    headerCells.push(inner.map((x) => x.plain).join('').trim())
  }
  // 본문 행(1번째 이후)마다 블록 생성.
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const cellPieces: CleanPiece[] = []
    const spokenParts: string[] = []
    const rowLine = lineOf(row)
    let ci = 0
    for (const cell of row.children) {
      const inner: CleanPiece[] = []
      for (const child of cell.children) collectPhrasing(child, opts, inner)
      const cellText = inner.map((x) => x.plain).join('').trim()
      const off = nodeOffsets(cell)
      if (cellText !== '' && off) {
        // text 용 piece(원문 범위 보존 → 불변식). 둘째 셀부터 ", " 구분.
        if (cellPieces.length > 0) {
          const sep = piece(', ', off.start, off.start)
          if (sep) cellPieces.push(sep)
        }
        const p = piece(cellText, off.start, off.end)
        if (p) cellPieces.push(p)
        // spokenText 용: "헤더는 값"(헤더 없으면 값만).
        const header = headerCells[ci] ?? ''
        spokenParts.push(header ? `${header}${josaEunNeun(header)} ${cellText}` : cellText)
      }
      ci++
    }
    const b = blockFromPieces(cellPieces, false, undefined, rowLine.start, rowLine.end)
    if (b) {
      b.spokenText = spokenParts.join(', ')
      out.push(b)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// public API
// ─────────────────────────────────────────────────────────────

/**
 * 마크다운 원문을 정제 블록 배열로 변환한다.
 * 반환 타입은 CleanBlock[] 계약을 만족(추가로 pieces 를 포함하는 CleanBlockEx).
 * chunkify 는 같은 모듈에서 pieces 를 활용하므로 CleanBlockEx 로 받는 것이 이상적이지만,
 * 외부 계약상 CleanBlock[] 이어도 동작하도록 chunkify 가 rawText 로 재파싱 없이 처리한다.
 */
export function refineMarkdown(rawText: string, opts: RefineOptions = DEFAULT_REFINE_OPTIONS): CleanBlock[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(rawText) as Root
  const blocks: CleanBlockEx[] = []
  for (const node of tree.children) collectFlow(node, opts, rawText, blocks)
  return blocks
}
