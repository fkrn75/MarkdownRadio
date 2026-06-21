<script lang="ts">
  /**
   * FN-10 · 정독 뷰 (원문 + 오프셋 동기 하이라이트)
   *
   * 폐루프 핵심: 원문 위치 = chunk.startOffset + charOffset 로 **직접** 계산해
   * 스크롤 + 하이라이트한다(별도 매핑/시간역산 없음).
   *
   * 표현 분리 원칙: 청취는 정제본, 정독은 **원문 그대로**.
   * 마크다운을 HTML로 렌더하면 문자 오프셋↔DOM 매핑이 깨져 폐루프 불변식이
   * 무너지므로, 여기서는 원문을 그대로(공백·줄바꿈 보존) 보여주고
   * 오프셋 구간만 <mark>로 강조한다. (시각적 MD 렌더는 오프셋 안전성 확보 후 별도 과제)
   *
   * props:
   *  - rawText: 원문 전체
   *  - chunks:  청크 배열(문장 클릭 → 역방향 재생, startOffset 기준)
   *  - bookmarks: 북마크(점프 대상 표시는 BookmarkList가, 여기선 위치 계산만)
   *  - currentChunkIndex: 재생 중 현재 청크(동기 하이라이트)
   *  - jumpOffset: 외부(북마크 클릭)에서 지정한 원문 오프셋 → 스크롤 대상
   *  - onSeek: 문장 클릭 → 그 청크부터 재생(SHOULD)
   */
  import type { Bookmark, Chunk } from '../lib/types'
  import { logEvent } from '../lib/instrumentation'

  interface Props {
    rawText: string
    chunks: Chunk[]
    bookmarks?: Bookmark[]
    /** 재생 중 현재 청크 인덱스(동기 하이라이트). */
    currentChunkIndex?: number
    /** 북마크 점프 등으로 지정된 원문 오프셋(스크롤 대상). */
    jumpOffset?: number
    /** 문장 클릭 → 해당 청크부터 재생(역방향 연결, SHOULD). */
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

  // 컨테이너/하이라이트 요소 참조(스크롤 대상)
  let container: HTMLDivElement | undefined = $state()
  let currentMark: HTMLElement | undefined = $state()
  let jumpMark: HTMLElement | undefined = $state()

  /**
   * 현재 재생 청크의 원문 범위 [start, end). 동기 하이라이트용.
   * silence(빈 텍스트)거나 인덱스 없으면 null.
   */
  let currentRange = $derived.by<{ start: number; end: number } | null>(() => {
    if (typeof currentChunkIndex !== 'number') return null
    const c = chunks[currentChunkIndex]
    if (!c || c.kind === 'silence') return null
    return { start: c.startOffset, end: c.endOffset }
  })

  /**
   * 원문을 분절(segment) 목록으로 나눈다.
   * 각 청크의 [startOffset,endOffset) 구간을 클릭 가능한 문장 span으로,
   * 청크 사이의 간극(마커·공백 등 정제로 빠진 부분)은 일반 텍스트로.
   * 이렇게 하면 문자 오프셋이 원문과 1:1로 유지된다.
   */
  interface Seg {
    text: string
    chunkIndex: number | null // 청크 구간이면 인덱스, 간극이면 null
    start: number
  }
  let segments = $derived.by<Seg[]>(() => {
    const segs: Seg[] = []
    // speech 청크만(무음은 원문 범위가 헤더와 겹치거나 빈 경우가 있어 클릭 대상에서 제외)
    const speech = chunks
      .filter((c) => c.kind !== 'silence' && c.endOffset > c.startOffset)
      .sort((a, b) => a.startOffset - b.startOffset)

    let pos = 0
    for (const c of speech) {
      const s = Math.max(c.startOffset, pos)
      const e = Math.max(c.endOffset, s)
      // 청크 앞 간극(있으면 일반 텍스트)
      if (s > pos) {
        segs.push({ text: rawText.slice(pos, s), chunkIndex: null, start: pos })
      }
      // 청크 본문(클릭 가능)
      if (e > s) {
        segs.push({ text: rawText.slice(s, e), chunkIndex: c.index, start: s })
      }
      pos = Math.max(pos, e)
    }
    // 마지막 간극(문서 끝까지)
    if (pos < rawText.length) {
      segs.push({ text: rawText.slice(pos), chunkIndex: null, start: pos })
    }
    // 청크가 하나도 없으면 원문 전체를 단일 간극으로
    if (segs.length === 0) {
      segs.push({ text: rawText, chunkIndex: null, start: 0 })
    }
    return segs
  })

  /** 세그먼트가 현재 재생 범위와 겹치는지(동기 하이라이트). */
  function isCurrent(seg: Seg): boolean {
    if (!currentRange || seg.chunkIndex === null) return false
    const segEnd = seg.start + seg.text.length
    return seg.start < currentRange.end && segEnd > currentRange.start
  }

  /** 세그먼트가 jumpOffset 을 포함하는지(점프 대상). */
  function isJumpTarget(seg: Seg): boolean {
    if (typeof jumpOffset !== 'number' || seg.chunkIndex === null) return false
    const segEnd = seg.start + seg.text.length
    return jumpOffset >= seg.start && jumpOffset < segEnd
  }

  // 점프 오프셋이 바뀌면 해당 위치로 스크롤(+ jump_resolved 는 엔진/통합이 담당하므로 여기선 스크롤만).
  $effect(() => {
    if (typeof jumpOffset !== 'number') return
    // DOM 갱신 후 스크롤되도록 microtask 뒤로 미룸
    queueMicrotask(() => {
      jumpMark?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  })

  // 재생 중 현재 문장이 화면 밖이면 따라 스크롤(부드럽게).
  $effect(() => {
    if (!currentRange) return
    queueMicrotask(() => {
      currentMark?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  })

  function handleSegClick(seg: Seg): void {
    if (seg.chunkIndex === null || !onSeek) return
    onSeek(seg.chunkIndex)
  }

  // 스크롤 계측(read_scroll, 패시브). 과도 호출 방지 위해 쓰로틀.
  let scrollThrottle = 0
  function onScroll(): void {
    if (!docId || !docHash) return
    const now = Date.now()
    if (now - scrollThrottle < 1000) return // 1초 쓰로틀
    scrollThrottle = now
    // 근방 청크 추정: 현재 재생 청크가 있으면 그것을, 없으면 생략
    const chunkIndex =
      typeof currentChunkIndex === 'number' ? currentChunkIndex : undefined
    logEvent('read_scroll', { docId, docHash, chunkIndex })
  }
</script>

<div class="reading" bind:this={container} onscroll={onScroll}>
  <article class="doc">
    {#each segments as seg (seg.start)}
      {#if seg.chunkIndex === null}
        <!-- 정제로 빠진 간극(마커·공백 등): 원문 그대로, 비클릭 -->
        <span class="gap">{seg.text}</span>
      {:else if isCurrent(seg)}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <mark
          class="cur"
          bind:this={currentMark}
          role={onSeek ? 'button' : undefined}
          tabindex={onSeek ? 0 : undefined}
          onclick={() => handleSegClick(seg)}
          onkeydown={(e) => {
            if (onSeek && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              handleSegClick(seg)
            }
          }}>{seg.text}</mark>
      {:else if isJumpTarget(seg)}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <mark
          class="jump"
          bind:this={jumpMark}
          role={onSeek ? 'button' : undefined}
          tabindex={onSeek ? 0 : undefined}
          onclick={() => handleSegClick(seg)}
          onkeydown={(e) => {
            if (onSeek && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              handleSegClick(seg)
            }
          }}>{seg.text}</mark>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <span
          class="sent"
          class:clickable={!!onSeek}
          role={onSeek ? 'button' : undefined}
          tabindex={onSeek ? 0 : undefined}
          onclick={() => handleSegClick(seg)}
          onkeydown={(e) => {
            if (onSeek && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              handleSegClick(seg)
            }
          }}>{seg.text}</span>
      {/if}
    {/each}
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
    /* 원문 그대로(줄바꿈·공백 보존) — 오프셋 1:1 유지의 핵심 */
    white-space: pre-wrap;
    word-break: keep-all;
    overflow-wrap: anywhere;
    font-size: 1.02rem;
    line-height: 1.85;
    color: var(--text);
  }
  .gap {
    color: var(--text-muted);
  }
  .sent {
    border-radius: 4px;
  }
  .sent.clickable {
    cursor: pointer;
  }
  .sent.clickable:hover {
    background: var(--accent-soft);
  }
  mark.cur {
    background: var(--highlight);
    color: inherit;
    border-radius: 4px;
    padding: 0 1px;
    cursor: pointer;
  }
  mark.jump {
    background: var(--highlight-bookmark);
    color: inherit;
    border-radius: 4px;
    padding: 0 1px;
    cursor: pointer;
  }
</style>
