<script lang="ts">
  /**
   * FN-11 · 문서 라이브러리
   *  - 문서 목록(제목·날짜·청크 수·북마크 수) 표시
   *  - 선택 → onselect(id), 삭제 → 확인 후 라이브러리 스토어에서 제거
   *
   * 데이터는 libraryStore(룬)에서 읽는다. 마운트 시 refresh() 1회.
   */
  import type { StoredDocument } from '../lib/types'
  import { libraryStore } from '../lib/stores/library.svelte'

  interface Props {
    /** 문서 선택 → 플레이어로 전환(상위 책임). */
    onselect: (id: string) => void
  }

  let { onselect }: Props = $props()

  // 마운트 시 목록 로드(이미 로드됐어도 최신화)
  $effect(() => {
    void libraryStore.refresh()
  })

  /** 청크 수: chunks 캐시가 있으면 길이, 없으면 미정(–). */
  function chunkCount(doc: StoredDocument): string {
    return doc.chunks ? String(doc.chunks.length) : '–'
  }

  /** 날짜를 'YYYY.MM.DD' 로 표기(로케일 비의존, 짧게). */
  function fmtDate(ts: number): string {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
  }

  async function remove(e: MouseEvent, doc: StoredDocument): Promise<void> {
    e.stopPropagation() // 카드 클릭(선택)과 분리
    const ok = confirm(`"${doc.title}" 문서를 삭제할까요? 연결된 북마크도 함께 지워집니다.`)
    if (!ok) return
    await libraryStore.remove(doc.id)
  }
</script>

<div class="library">
  {#if !libraryStore.loaded}
    <p class="empty">불러오는 중…</p>
  {:else if libraryStore.documents.length === 0}
    <p class="empty">아직 문서가 없습니다. 위에서 추가해 보세요.</p>
  {:else}
    <ul class="cards">
      {#each libraryStore.documents as doc (doc.id)}
        <li>
          <button
            type="button"
            class="card"
            onclick={() => onselect(doc.id)}
            aria-label={`${doc.title} 열기`}
          >
            <span class="title">{doc.title}</span>
            <span class="meta">
              <span class="date">{fmtDate(doc.updatedAt ?? doc.createdAt)}</span>
              <span class="sep" aria-hidden="true">·</span>
              <span>청크 {chunkCount(doc)}</span>
              <span class="sep" aria-hidden="true">·</span>
              <span class="bm" class:has={libraryStore.countFor(doc.id) > 0}>
                🔖 {libraryStore.countFor(doc.id)}
              </span>
            </span>
          </button>
          <button
            type="button"
            class="del"
            onclick={(e) => remove(e, doc)}
            aria-label={`${doc.title} 삭제`}
            title="삭제"
          >
            ✕
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .library {
    width: 100%;
  }
  .empty {
    color: var(--text-muted);
    text-align: center;
    padding: 1.5rem 0;
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  li {
    display: flex;
    align-items: stretch;
    gap: 0.4rem;
  }
  .card {
    flex: 1;
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    box-shadow: var(--shadow);
    transition: border-color 0.15s, transform 0.05s;
  }
  .card:hover {
    border-color: var(--accent);
  }
  .card:active {
    transform: translateY(1px);
  }
  .title {
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    color: var(--text-muted);
    font-size: 0.82rem;
  }
  .sep {
    opacity: 0.5;
  }
  .bm.has {
    color: var(--accent);
    font-weight: 600;
  }
  .del {
    flex: none;
    width: 2.4rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .del:hover {
    color: var(--warn);
    border-color: var(--warn);
    background: var(--warn-soft);
  }
</style>
