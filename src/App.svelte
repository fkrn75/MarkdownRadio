<script lang="ts">
  /**
   * App — 폐루프 통합 셸
   *
   * 흐름: 업로드/선택 → buildChunks(정제·청크) → engine.load → 청취
   *        → 🔖 북마크({chunkIndex,charOffset}) → 정독뷰에서 원문 정확 위치 점프.
   *
   * 위치(currentChunkIndex)는 App이 engine.on('chunkChange')를 직접 구독해 추적한다.
   * 이렇게 하면 탭(청취/정독)을 전환해 Player가 언마운트돼도 정독뷰 동기 하이라이트가 유지된다.
   */
  import { buildChunks } from './lib/refine'
  import { createEngine, SupertonicEngine, type ModelLoadProgress } from './lib/engine'
  import { hashText, logEvent } from './lib/instrumentation'
  import { settingsStore } from './lib/stores/settings.svelte'
  import { libraryStore } from './lib/stores/library.svelte'
  import { addBookmark, listBookmarks, deleteBookmark, getDocument } from './lib/db/idb'
  import type {
    Bookmark,
    Chunk,
    EnginePosition,
    EngineKind,
    RadioEngine,
    RawDocument,
    StoredDocument,
  } from './lib/types'
  import Uploader from './components/Uploader.svelte'
  import Library from './components/Library.svelte'
  import Player from './components/Player.svelte'
  import ReadingView from './components/ReadingView.svelte'
  import BookmarkList from './components/BookmarkList.svelte'

  type View = 'home' | 'player'
  type Tab = 'listen' | 'read' | 'bookmarks'

  let view = $state<View>('home')
  let tab = $state<Tab>('listen')

  // 엔진 인스턴스(설정에 따라 webspeech/supertonic). 전환 시 재생성.
  let engine = $state<RadioEngine>(createEngine(settingsStore.value.engine))
  // Supertonic 모델 다운로드/로딩 진행률(UI 배너용)
  let modelProgress = $state<ModelLoadProgress | null>(null)

  let curDoc = $state<StoredDocument | null>(null)
  let chunks = $state<Chunk[]>([])
  let bookmarks = $state<Bookmark[]>([])
  let currentChunkIndex = $state(0)
  let jumpOffset = $state<number | undefined>(undefined)

  const docHash = $derived(curDoc ? hashText(curDoc.rawText) : '')

  // 엔진 위치를 App 에서 직접 추적(탭 전환과 무관하게 정독뷰 동기화 유지)
  $effect(() => {
    const onChange = (p: EnginePosition) => {
      currentChunkIndex = p.chunkIndex
    }
    engine.on('chunkChange', onChange)
    return () => engine.off('chunkChange', onChange)
  })

  // 설정의 음성(voiceURI)을 엔진에 반영(없으면 null = 남성 우선 기본)
  $effect(() => {
    engine.setVoice?.(settingsStore.value.voiceURI ?? null)
  })

  // Supertonic 모델 다운로드/로딩 진행률 구독(엔진 교체 시 자동 재구독)
  $effect(() => {
    const e = engine
    if (e instanceof SupertonicEngine) {
      e.onModelProgress((p) => (modelProgress = p))
      return () => e.onModelProgress(null)
    }
  })

  /** 엔진 종류 전환(기본 webspeech ↔ 온디바이스 supertonic) */
  async function setEngineKind(kind: EngineKind): Promise<void> {
    if (kind === settingsStore.value.engine) return
    engine.stop()
    if (engine instanceof SupertonicEngine) engine.dispose()
    modelProgress = null
    settingsStore.patch({ engine: kind })
    const ctx = curDoc ? { docId: curDoc.id, docHash: hashText(curDoc.rawText) } : undefined
    engine = createEngine(kind, ctx)
    // 현재 문서가 열려 있으면 새 엔진으로 다시 로드(Supertonic이면 모델 다운로드 시작)
    if (curDoc) {
      currentChunkIndex = 0
      await engine.load(chunks)
    }
  }

  /** 문서를 열어 청크 준비 + 엔진 로드 + 플레이어 진입 */
  async function openDocument(doc: StoredDocument) {
    curDoc = doc
    // 캐시된 청크가 있으면 재정제 생략, 없으면 즉석 정제
    const ready = doc.chunks && doc.chunks.length > 0 ? doc.chunks : buildChunks(doc.rawText).chunks
    chunks = ready
    const h = hashText(doc.rawText)
    await engine.load(chunks)
    // 재생 계측(chunk_play_*, jump_resolved)이 올바른 docId/docHash 로 적재되게 컨텍스트 주입
    engine.setDocContext?.({ docId: doc.id, docHash: h })
    bookmarks = await listBookmarks(doc.id)
    currentChunkIndex = 0
    jumpOffset = undefined
    tab = 'listen'
    view = 'player'
    logEvent('doc_open', { docId: doc.id, docHash: h })
  }

  /** 업로드 → 정제 → 라이브러리 저장 → 바로 열기 */
  async function handleUpload(raw: RawDocument) {
    const { chunks: built } = buildChunks(raw.rawText)
    const now = Date.now()
    const doc: StoredDocument = {
      id: raw.id,
      title: raw.title,
      rawText: raw.rawText,
      chunks: built,
      createdAt: now,
      updatedAt: now,
    }
    await libraryStore.upsert(doc)
    await openDocument(doc)
  }

  async function handleSelect(id: string) {
    const doc = await getDocument(id)
    if (doc) await openDocument(doc)
  }

  /** 🔖 북마크 저장 + 목록 갱신 */
  async function handleBookmark(b: Bookmark) {
    await addBookmark(b)
    bookmarks = await listBookmarks(b.documentId)
  }

  async function handleDeleteBookmark(id: string) {
    await deleteBookmark(id)
    if (curDoc) bookmarks = await listBookmarks(curDoc.id)
  }

  /** 북마크 클릭 → 원문 위치(startOffset+charOffset)로 정독뷰 점프 */
  function handleJump(b: Bookmark) {
    const c = chunks[b.chunkIndex]
    if (!c) return
    jumpOffset = c.startOffset + b.charOffset
    tab = 'read'
  }

  function goHome() {
    engine.stop()
    view = 'home'
    libraryStore.refresh()
  }
</script>

<div class="shell">
  <header class="topbar">
    {#if view === 'player'}
      <button class="back" onclick={goHome} aria-label="라이브러리로">←</button>
    {:else}
      <span class="dot" aria-hidden="true"></span>
    {/if}
    <h1>{view === 'player' && curDoc ? curDoc.title : 'Markdown Radio'}</h1>
  </header>

  {#if modelProgress && modelProgress.ratio < 1}
    <div class="model-progress" role="status">
      <span class="mp-label">{modelProgress.label}… {Math.round(modelProgress.ratio * 100)}%</span>
      <progress max="1" value={modelProgress.ratio}></progress>
    </div>
  {/if}

  {#if view === 'home'}
    <section class="home">
      <div class="engine-pick">
        <span class="engine-label">음성 엔진</span>
        <div class="engine-opts">
          <button
            class:active={settingsStore.value.engine === 'webspeech'}
            onclick={() => setEngineKind('webspeech')}
          >
            기본 <small>빠름 · 무설치</small>
          </button>
          <button
            class:active={settingsStore.value.engine === 'supertonic'}
            onclick={() => setEngineKind('supertonic')}
          >
            고품질 Supertonic <small>최초 1회 ~263MB</small>
          </button>
        </div>
      </div>
      <Uploader onload={handleUpload} />
      <Library onselect={handleSelect} />
    </section>
  {:else if curDoc}
    <div class="tabs" role="tablist">
      <button class:active={tab === 'listen'} role="tab" aria-selected={tab === 'listen'} onclick={() => (tab = 'listen')}>청취</button>
      <button class:active={tab === 'read'} role="tab" aria-selected={tab === 'read'} onclick={() => (tab = 'read')}>정독</button>
      <button class:active={tab === 'bookmarks'} role="tab" aria-selected={tab === 'bookmarks'} onclick={() => (tab = 'bookmarks')}>
        북마크{bookmarks.length ? ` (${bookmarks.length})` : ''}
      </button>
    </div>

    <section class="content">
      {#if tab === 'listen'}
        <Player
          {chunks}
          {engine}
          docId={curDoc.id}
          {docHash}
          onBookmark={handleBookmark}
        />
      {:else if tab === 'read'}
        <ReadingView
          rawText={curDoc.rawText}
          {chunks}
          {bookmarks}
          {currentChunkIndex}
          {jumpOffset}
          onSeek={(i) => engine.seekToChunk(i)}
          docId={curDoc.id}
          {docHash}
        />
      {:else}
        <BookmarkList
          {bookmarks}
          onJump={handleJump}
          ondelete={handleDeleteBookmark}
          docId={curDoc.id}
          {docHash}
        />
      {/if}
    </section>
  {/if}
</div>

<style>
  .shell {
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
    padding: 0.75rem 1rem 3rem;
    flex: 1;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0 1rem;
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 5;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
    flex: none;
  }
  .back {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    border-radius: 9px;
    width: 34px;
    height: 34px;
    font-size: 1.1rem;
    line-height: 1;
    flex: none;
  }
  h1 {
    font-size: 1.15rem;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .home {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    background: var(--surface-2);
    padding: 0.25rem;
    border-radius: 11px;
    margin-bottom: 1rem;
  }
  .tabs button {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-muted);
    padding: 0.55rem 0.5rem;
    border-radius: 8px;
    font-size: 0.95rem;
    font-weight: 600;
  }
  .tabs button.active {
    background: var(--surface);
    color: var(--accent);
    box-shadow: var(--shadow);
  }

  .engine-pick {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .engine-label {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: 600;
  }
  .engine-opts {
    display: flex;
    gap: 0.5rem;
  }
  .engine-opts button {
    flex: 1;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0.7rem 0.6rem;
    font-size: 0.95rem;
    font-weight: 600;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    line-height: 1.25;
  }
  .engine-opts button small {
    font-weight: 400;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .engine-opts button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .engine-opts button.active small {
    color: var(--accent);
  }
  .model-progress {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    background: var(--accent-soft);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.6rem 0.8rem;
    margin-bottom: 1rem;
  }
  .mp-label {
    font-size: 0.85rem;
    color: var(--accent);
    font-weight: 600;
  }
  .model-progress progress {
    width: 100%;
    height: 8px;
    accent-color: var(--accent);
  }
</style>
