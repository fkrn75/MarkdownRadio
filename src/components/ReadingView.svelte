<script lang="ts">
  /**
   * FN-10 · 정독 뷰 (마크다운 HTML 렌더 + 오프셋 동기 하이라이트)
   *
   * 표현력: typedown 급 GFM 풀셋 렌더(헤더·강조·취소선·인라인/블록 코드·인용·리스트·
   *         체크박스·표·이미지·링크·수평선). 모바일 마크다운 뷰어 대용 타이포그래피.
   *
   * 폐루프 핵심(불변식 유지): 마크다운을 mdast 로 1회 파싱하고, 각 요소에 원문 오프셋
   *   (node.position.*.offset = Chunk.startOffset/endOffset 과 같은 좌표계)을 data-start/data-end 로
   *   부여한다(MarkdownNode.svelte). 재생 중 현재 청크 범위·북마크 점프 offset 을 그 data-* 위에서
   *   매핑해 하이라이트/스크롤한다. → refine/·chunk.ts·types.ts 는 무수정(이 컴포넌트는 표시 레이어).
   *
   * 하이라이트는 재파싱 없이 **DOM 클래스 토글**로만 수행한다(파싱 1회 유지).
   *
   * props (기존과 동일 — App.svelte 무수정):
   *  - rawText: 원문 전체
   *  - chunks:  청크 배열(클릭 → 역방향 재생, startOffset 기준)
   *  - bookmarks: (위치 계산은 App, 여기선 미사용이나 인터페이스 유지)
   *  - currentChunkIndex: 재생 중 현재 청크(동기 하이라이트)
   *  - jumpOffset: 외부(북마크 클릭)에서 지정한 원문 오프셋 → 스크롤 대상
   *  - onSeek: 문장 클릭 → 그 청크부터 재생(SHOULD)
   */
  import type { Bookmark, Chunk } from '../lib/types'
  import { logEvent } from '../lib/instrumentation'
  import {
    parseMarkdown,
    findElementForRange,
    rangeForOffset,
    chunkIndexForOffset,
  } from '../lib/markdown'
  import MarkdownNode from './MarkdownNode.svelte'

  interface Props {
    rawText: string
    chunks: Chunk[]
    bookmarks?: Bookmark[]
    /** 재생 중 현재 청크 인덱스(동기 하이라이트). */
    currentChunkIndex?: number
    /** 북마크 점프 등으로 지정된 원문 오프셋(스크롤 대상). */
    jumpOffset?: number
    /** 문장(요소) 클릭 → 해당 청크부터 재생(역방향 연결, SHOULD). */
    onSeek?: (chunkIndex: number) => void
    /** 계측용 문서 식별(read_scroll). 없으면 스크롤 계측 생략. */
    docId?: string
    docHash?: string
  }

  let {
    rawText,
    chunks,
    bookmarks = [],
    currentChunkIndex,
    jumpOffset,
    onSeek,
    docId,
    docHash,
  }: Props = $props()

  // 컨테이너/렌더 호스트 참조
  let container: HTMLDivElement | undefined = $state()
  let articleEl: HTMLElement | undefined = $state()

  // 원문 → mdast 트리(문서 로드/원문 변경 시 1회만 파싱)
  const tree = $derived(parseMarkdown(rawText))

  /**
   * 현재 재생 청크의 원문 범위 [start, end). 동기 하이라이트용.
   * silence(빈 텍스트)거나 인덱스 없으면 null.
   */
  const currentRange = $derived.by<{ start: number; end: number } | null>(() => {
    if (typeof currentChunkIndex !== 'number') return null
    const c = chunks[currentChunkIndex]
    if (!c || c.kind === 'silence') return null
    return { start: c.startOffset, end: c.endOffset }
  })

  // 이전에 .cur / .jump 를 부여한 요소(다음 갱신 때 제거용)
  let prevCurEl: HTMLElement | null = null
  let prevJumpEl: HTMLElement | null = null

  // 재생 중 현재 청크 하이라이트: offset 범위와 겹치는 가장 깊은 요소에 .cur + 따라 스크롤.
  $effect(() => {
    // 의존성: tree(렌더 후), currentRange. DOM 갱신 뒤 실행되도록 microtask.
    void tree
    const range = currentRange
    queueMicrotask(() => {
      if (prevCurEl) {
        prevCurEl.classList.remove('cur')
        prevCurEl = null
      }
      if (!range || !container) return
      const el = findElementForRange(container, range.start, range.end)
      if (el) {
        el.classList.add('cur')
        prevCurEl = el
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    })
  })

  // 북마크 점프: offset 포함 요소에 .jump + 정밀(Range) 스크롤.
  $effect(() => {
    void tree
    const off = jumpOffset
    if (typeof off !== 'number') return
    queueMicrotask(() => {
      if (prevJumpEl) {
        prevJumpEl.classList.remove('jump')
        prevJumpEl = null
      }
      if (!container) return
      const el = findElementForRange(container, off, off + 1)
      if (el) {
        el.classList.add('jump')
        prevJumpEl = el
      }
      // 정밀 스크롤: offset 포함 요소를 Range 로 감싸 가운데로. 실패 시 요소로 폴백.
      const range = rangeForOffset(container, off)
      if (range) {
        const rect = range.getBoundingClientRect()
        const host = range.startContainer.parentElement
        if (rect.height > 0 && host) {
          host.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } else if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      } else if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
  })

  // 요소 클릭(또는 Enter/Space) → offset 으로 청크를 찾아 그 지점부터 재생.
  function handleClick(e: MouseEvent): void {
    if (!onSeek) return
    const target = (e.target as HTMLElement | null)?.closest('[data-start]') as
      | HTMLElement
      | null
    if (!target || !container || !container.contains(target)) return
    seekFromElement(target)
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (!onSeek) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    const target = (e.target as HTMLElement | null)?.closest('[data-start]') as
      | HTMLElement
      | null
    if (!target) return
    // 링크/체크박스 등 기본 동작이 있는 요소는 가로채지 않음
    const tag = target.tagName.toLowerCase()
    if (tag === 'a' || tag === 'input') return
    e.preventDefault()
    seekFromElement(target)
  }

  function seekFromElement(el: HTMLElement): void {
    const start = Number(el.dataset.start)
    if (!Number.isFinite(start)) return
    const idx = chunkIndexForOffset(chunks, start)
    if (idx >= 0) onSeek?.(idx)
  }

  // 스크롤 계측(read_scroll, 패시브). 과도 호출 방지 위해 쓰로틀.
  let scrollThrottle = 0
  function onScroll(): void {
    if (!docId || !docHash) return
    const now = Date.now()
    if (now - scrollThrottle < 1000) return // 1초 쓰로틀
    scrollThrottle = now
    const chunkIndex =
      typeof currentChunkIndex === 'number' ? currentChunkIndex : undefined
    logEvent('read_scroll', { docId, docHash, chunkIndex })
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="reading"
  class:seekable={!!onSeek}
  bind:this={container}
  onscroll={onScroll}
  onclick={handleClick}
  onkeydown={handleKeydown}
>
  <article class="doc markdown-body" bind:this={articleEl}>
    <MarkdownNode node={tree} />
  </article>
</div>

<style>
  .reading {
    width: 100%;
    max-height: 60vh;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem 1.4rem;
    box-shadow: var(--shadow);
  }
  .doc {
    font-size: 1.02rem;
    line-height: 1.8;
    color: var(--text);
    word-break: keep-all;
    overflow-wrap: anywhere;
  }

  /* ── 하이라이트(폐루프): 재생 중 현재 요소 / 북마크 점프 요소 ── */
  .doc :global(.cur) {
    background: var(--highlight);
    border-radius: 4px;
    box-shadow: 0 0 0 2px var(--highlight);
    scroll-margin: 1rem;
  }
  .doc :global(.jump) {
    background: var(--highlight-bookmark);
    border-radius: 4px;
    box-shadow: 0 0 0 2px var(--highlight-bookmark);
    scroll-margin: 1rem;
  }
  /* 클릭 가능(onSeek) 시 텍스트 블록 호버 표시 */
  .seekable .doc :global(p),
  .seekable .doc :global(li),
  .seekable .doc :global(h1),
  .seekable .doc :global(h2),
  .seekable .doc :global(h3),
  .seekable .doc :global(h4),
  .seekable .doc :global(h5),
  .seekable .doc :global(h6),
  .seekable .doc :global(blockquote) {
    cursor: pointer;
  }

  /* ── 타이포그래피(typedown 급 GFM) ── */
  .doc :global(h1),
  .doc :global(h2),
  .doc :global(h3),
  .doc :global(h4),
  .doc :global(h5),
  .doc :global(h6) {
    line-height: 1.3;
    font-weight: 700;
    margin: 1.6em 0 0.6em;
    color: var(--text);
  }
  .doc :global(h1) {
    font-size: 1.7rem;
    padding-bottom: 0.3em;
    border-bottom: 1px solid var(--border);
  }
  .doc :global(h2) {
    font-size: 1.4rem;
    padding-bottom: 0.25em;
    border-bottom: 1px solid var(--border);
  }
  .doc :global(h3) {
    font-size: 1.2rem;
  }
  .doc :global(h4) {
    font-size: 1.05rem;
  }
  .doc :global(h5),
  .doc :global(h6) {
    font-size: 0.95rem;
    color: var(--text-muted);
  }
  .doc :global(h1:first-child),
  .doc :global(h2:first-child),
  .doc :global(h3:first-child) {
    margin-top: 0.2em;
  }
  .doc :global(p) {
    margin: 0.7em 0;
  }
  .doc :global(strong) {
    font-weight: 700;
  }
  .doc :global(em) {
    font-style: italic;
  }
  .doc :global(del) {
    color: var(--text-muted);
  }
  .doc :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .doc :global(.link-fallback) {
    color: var(--text-muted);
  }

  /* 인라인 코드 */
  .doc :global(code.inline) {
    font-family: ui-monospace, "Cascadia Code", "Consolas", monospace;
    font-size: 0.88em;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0.08em 0.36em;
    word-break: break-all;
  }

  /* 코드 블록(언어 라벨 + 가로스크롤) */
  .doc :global(.codeblock) {
    position: relative;
    margin: 1em 0;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .doc :global(.codeblock .lang) {
    display: block;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-muted);
    padding: 0.35em 0.8em;
    border-bottom: 1px solid var(--border);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .doc :global(.codeblock pre) {
    margin: 0;
    padding: 0.8em 0.9em;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .doc :global(.codeblock code) {
    font-family: ui-monospace, "Cascadia Code", "Consolas", monospace;
    font-size: 0.85rem;
    line-height: 1.6;
    color: var(--text);
    white-space: pre;
    word-break: normal;
  }

  /* 인용 */
  .doc :global(blockquote) {
    margin: 1em 0;
    padding: 0.4em 1em;
    border-left: 4px solid var(--accent);
    background: var(--accent-soft);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    color: var(--text-muted);
  }
  .doc :global(blockquote p) {
    margin: 0.3em 0;
  }

  /* 리스트 */
  .doc :global(ul),
  .doc :global(ol) {
    margin: 0.7em 0;
    padding-left: 1.5em;
  }
  .doc :global(li) {
    margin: 0.3em 0;
  }
  .doc :global(li > ul),
  .doc :global(li > ol) {
    margin: 0.3em 0;
  }
  /* GFM 체크박스(task list) */
  .doc :global(li.task) {
    list-style: none;
    margin-left: -1.3em;
    display: flex;
    align-items: flex-start;
    gap: 0.5em;
  }
  .doc :global(li.task input) {
    margin-top: 0.32em;
    flex: none;
    accent-color: var(--accent);
  }
  .doc :global(li.task .task-body) {
    flex: 1;
  }
  .doc :global(li.task .task-body p) {
    margin: 0;
    display: inline;
  }

  /* 표(모바일 가로스크롤) */
  .doc :global(.table-wrap) {
    margin: 1em 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .doc :global(table) {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.92rem;
  }
  .doc :global(th),
  .doc :global(td) {
    border: 1px solid var(--border);
    padding: 0.5em 0.7em;
    text-align: left;
    vertical-align: top;
  }
  .doc :global(thead th) {
    background: var(--surface-2);
    font-weight: 700;
    white-space: nowrap;
  }
  .doc :global(tbody tr:nth-child(even)) {
    background: color-mix(in srgb, var(--surface-2) 45%, transparent);
  }

  /* 이미지 */
  .doc :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-sm);
    display: block;
    margin: 0.8em 0;
  }
  .doc :global(.img-fallback) {
    display: inline-block;
    color: var(--text-muted);
    font-style: italic;
    padding: 0.3em 0.6em;
    background: var(--surface-2);
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
  }

  /* 수평선 */
  .doc :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1.6em 0;
  }

  /* 각주 */
  .doc :global(.fn-ref) {
    font-size: 0.75em;
    color: var(--accent);
    vertical-align: super;
  }
  .doc :global(.fn-def) {
    font-size: 0.88rem;
    color: var(--text-muted);
    margin: 0.4em 0;
    padding-left: 0.5em;
    border-left: 2px solid var(--border);
  }
  .doc :global(.fn-def .fn-id) {
    font-weight: 600;
    margin-right: 0.4em;
  }
  .doc :global(.fn-def p) {
    display: inline;
    margin: 0;
  }
</style>
