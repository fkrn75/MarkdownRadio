<script lang="ts">
  /**
   * 재생목록(큐) 패널 — task #23
   *  - 큐 항목을 표시하고 순서변경(▲▼)·점프·제거를 할 수 있다.
   *  - 상태/로직은 App 이 소유하고 props 로 내려준다. 이 컴포넌트는 표시 + 버튼 마크업만 담당.
   *  - 공유 계약(SSOT): items/currentIndex/onMoveUp/onMoveDown/onRemove/onJump/onClose.
   *    배치(모달/인라인)는 App 이 결정하므로 여기서는 컴포넌트 내부만 다룬다.
   */

  interface Props {
    /** 재생목록 순서대로(App 의 playQueue → 제목 매핑). */
    items: { id: string; title: string }[]
    /** 현재 재생 중 큐 위치(0-based). */
    currentIndex: number
    /** i 번째 항목을 위로 이동. */
    onMoveUp: (i: number) => void
    /** i 번째 항목을 아래로 이동. */
    onMoveDown: (i: number) => void
    /** i 번째 항목을 재생목록에서 제거. */
    onRemove: (i: number) => void
    /** i 번째 문서로 즉시 점프 재생. */
    onJump: (i: number) => void
    /** 패널 닫기. */
    onClose: () => void
  }

  let { items, currentIndex, onMoveUp, onMoveDown, onRemove, onJump, onClose }: Props = $props()

  /** 마지막 항목 인덱스(▼ 비활성 판단). 빈 목록이면 -1. */
  let lastIndex = $derived(items.length - 1)
</script>

<div class="queue-panel">
  <div class="queue-head">
    <span class="title">재생목록</span>
    <span class="count">{items.length}곡</span>
    <button type="button" class="q-btn close" onclick={onClose} aria-label="재생목록 닫기" title="닫기">
      ✕
    </button>
  </div>

  {#if items.length === 0}
    <p class="empty">재생목록이 비어 있습니다.</p>
  {:else}
    <ol class="queue-list">
      {#each items as item, i (item.id)}
        <li class="queue-item" class:current={i === currentIndex}>
          {#if i === currentIndex}
            <span class="marker" aria-hidden="true">▶</span>
          {:else}
            <span class="marker placeholder" aria-hidden="true"></span>
          {/if}

          <button
            type="button"
            class="jump"
            onclick={() => onJump(i)}
            title="이 문서로 점프"
            aria-label={`${i + 1}번째 문서로 점프: ${item.title}`}
          >
            <span class="ord">{i + 1}.</span>
            <span class="name">{item.title}</span>
          </button>

          <div class="ctrls">
            <button
              type="button"
              class="q-btn"
              onclick={() => onMoveUp(i)}
              disabled={i === 0}
              aria-label="위로 이동"
              title="위로 이동"
            >
              ▲
            </button>
            <button
              type="button"
              class="q-btn"
              onclick={() => onMoveDown(i)}
              disabled={i === lastIndex}
              aria-label="아래로 이동"
              title="아래로 이동"
            >
              ▼
            </button>
            <button
              type="button"
              class="q-btn remove"
              onclick={() => onRemove(i)}
              disabled={i === currentIndex}
              aria-label="재생목록에서 제거"
              title={i === currentIndex ? '재생 중인 항목은 제거할 수 없습니다' : '재생목록에서 제거'}
            >
              ✕
            </button>
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .queue-panel {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: 60vh;
  }

  .queue-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .queue-head .title {
    font-weight: 700;
    color: var(--text);
  }
  .queue-head .count {
    color: var(--text-muted);
    font-size: 0.82rem;
  }
  .queue-head .close {
    margin-left: auto;
  }

  .empty {
    color: var(--text-muted);
    text-align: center;
    padding: 1.5rem 0.9rem;
    margin: 0;
  }

  .queue-list {
    list-style: none;
    margin: 0;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    overflow-y: auto;
  }

  .queue-item {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    padding: 0.25rem 0.4rem;
  }
  .queue-item.current {
    background: var(--accent-soft);
    border-color: var(--accent);
  }

  .marker {
    flex: none;
    width: 1.1rem;
    text-align: center;
    color: var(--accent);
    font-size: 0.8rem;
  }
  .marker.placeholder {
    color: transparent;
  }

  /* 제목 점프 버튼 — 가용 공간을 채우고 길면 말줄임 */
  .jump {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    text-align: left;
    border: none;
    background: transparent;
    color: var(--text);
    padding: 0.45rem 0.3rem;
    font-size: 0.92rem;
  }
  .jump .ord {
    flex: none;
    color: var(--text-muted);
    font-size: 0.82rem;
  }
  .jump .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .queue-item.current .jump {
    font-weight: 700;
  }
  .jump:hover .name {
    color: var(--accent);
    text-decoration: underline;
  }

  .ctrls {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.2rem;
  }

  /* 아이콘 버튼 — 터치 영역 최소 32px */
  .q-btn {
    flex: none;
    min-width: 32px;
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: 0.85rem;
    line-height: 1;
  }
  .q-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--surface-2);
  }
  .q-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .q-btn.remove:hover:not(:disabled) {
    border-color: var(--warn);
    color: var(--warn);
    background: var(--warn-soft);
  }
</style>
