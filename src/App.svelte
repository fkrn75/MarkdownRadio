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
  import { qualityToStep } from './lib/engine/supertonicProtocol'
  import { hashText, logEvent } from './lib/instrumentation'
  import { settingsStore } from './lib/stores/settings.svelte'
  import { libraryStore } from './lib/stores/library.svelte'
  import {
    addBookmark,
    listBookmarks,
    deleteBookmark,
    getDocument,
    updateLastChunkIndex,
  } from './lib/db/idb'
  import type {
    Bookmark,
    Chunk,
    EnginePosition,
    EngineKind,
    RadioEngine,
    RawDocument,
    StoredDocument,
    TtsQuality,
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
  // Supertonic 모델 로드 실패 메시지(있으면 배너에 재시도 버튼 노출)
  let modelError = $state<string | null>(null)

  let curDoc = $state<StoredDocument | null>(null)
  let chunks = $state<Chunk[]>([])
  let bookmarks = $state<Bookmark[]>([])
  let currentChunkIndex = $state(0)
  let jumpOffset = $state<number | undefined>(undefined)

  const docHash = $derived(curDoc ? hashText(curDoc.rawText) : '')

  // 엔진 위치를 App 에서 직접 추적(탭 전환과 무관하게 정독뷰 동기화 유지)
  // + 이어듣기: 위치 변화를 디바운스(2s)해 IndexedDB(StoredDocument.lastChunkIndex)에 저장.
  //   chunkChange는 매 청크마다 발생하므로 즉시 write 하지 않고 모아서 저장한다.
  let lastSaveTimer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    const onChange = (p: EnginePosition) => {
      currentChunkIndex = p.chunkIndex
      if (curDoc) {
        const id = curDoc.id
        const idx = p.chunkIndex
        clearTimeout(lastSaveTimer)
        lastSaveTimer = setTimeout(() => void updateLastChunkIndex(id, idx), 2000)
      }
    }
    engine.on('chunkChange', onChange)
    return () => {
      engine.off('chunkChange', onChange)
      clearTimeout(lastSaveTimer)
    }
  })

  // 설정의 음성(voiceURI)을 엔진에 반영(없으면 null = 남성 우선 기본)
  $effect(() => {
    engine.setVoice?.(settingsStore.value.voiceURI ?? null)
  })

  // 설정의 음질 프리셋(ttsQuality)을 Supertonic 엔진의 totalStep 으로 반영.
  $effect(() => {
    const e = engine
    if (e instanceof SupertonicEngine) {
      e.setTotalStep(qualityToStep(settingsStore.value.ttsQuality))
    }
  })

  // Supertonic 모델 다운로드/로딩 진행률 + 로드 에러 구독(엔진 교체 시 자동 재구독)
  $effect(() => {
    const e = engine
    if (e instanceof SupertonicEngine) {
      e.onModelProgress((p) => {
        modelProgress = p
        if (p.ratio >= 1) modelError = null
      })
      e.onModelError?.((msg) => (modelError = msg))
      return () => {
        e.onModelProgress(null)
        e.onModelError?.(null)
      }
    }
  })

  /** 엔진 종류 전환(기본 webspeech ↔ 온디바이스 supertonic) */
  async function setEngineKind(kind: EngineKind): Promise<void> {
    if (kind === settingsStore.value.engine) return
    engine.stop()
    if (engine instanceof SupertonicEngine) engine.dispose()
    modelProgress = null
    modelError = null
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
    // 캐시된 청크가 있으면 재정제 생략, 없으면 즉석 정제(사용자 정제/청크 설정 반영).
    // ⚠️ 향후 정제/청크 옵션을 바꾸는 설정 UI를 추가하면, 캐시(doc.chunks)가 옛 옵션으로
    //    만들어졌을 수 있으니 옵션 해시 비교로 캐시 무효화(재빌드)가 필요하다.
    const ready =
      doc.chunks && doc.chunks.length > 0
        ? doc.chunks
        : buildChunks(doc.rawText, {
            refine: settingsStore.value.refine,
            chunk: settingsStore.value.chunk,
          }).chunks
    chunks = ready
    const h = hashText(doc.rawText)
    await engine.load(chunks)
    // 재생 계측(chunk_play_*, jump_resolved)이 올바른 docId/docHash 로 적재되게 컨텍스트 주입
    engine.setDocContext?.({ docId: doc.id, docHash: h })
    bookmarks = await listBookmarks(doc.id)
    // 이어듣기: 마지막으로 듣던 청크로 복원(없으면 0). 위치만 맞추고 재생은 사용자 조작에 맡긴다.
    const resume = doc.lastChunkIndex && doc.lastChunkIndex > 0 ? doc.lastChunkIndex : 0
    currentChunkIndex = resume
    if (resume > 0) engine.seekToChunk(resume)
    jumpOffset = undefined
    tab = 'listen'
    view = 'player'
    logEvent('doc_open', { docId: doc.id, docHash: h })
  }

  /** 업로드 → 정제 → 라이브러리 저장 → 바로 열기 */
  async function handleUpload(raw: RawDocument) {
    const { chunks: built } = buildChunks(raw.rawText, {
      refine: settingsStore.value.refine,
      chunk: settingsStore.value.chunk,
    })
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

  /** 음질 프리셋 변경 — 설정만 저장(엔진 totalStep 반영은 위 $effect가 자동 수행). */
  function setQuality(q: TtsQuality) {
    settingsStore.setTtsQuality(q)
  }

  /** 모델 로드 재시도(에러 배너의 버튼). */
  function retryModel() {
    modelError = null
    if (engine instanceof SupertonicEngine) void engine.retryLoad()
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

  {#if modelError}
    <div class="model-error" role="alert">
      <span class="me-label">모델 로딩 실패: {modelError}</span>
      <button class="me-retry" onclick={retryModel}>다시 시도</button>
    </div>
  {:else if modelProgress && modelProgress.ratio < 1}
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
            고품질 Supertonic <small>최초 1회 ~380MB</small>
          </button>
        </div>
      </div>

      {#if settingsStore.value.engine === 'supertonic'}
        <div class="quality-pick">
          <span class="engine-label">음질 프리셋 <small class="ql-hint">높을수록 또렷·느림</small></span>
          <div class="quality-opts">
            {#each [['fast', '빠름', 'step 5'], ['standard', '표준', 'step 8'], ['high', '고품질', 'step 12']] as [q, label, hint] (q)}
              <button
                class:active={settingsStore.value.ttsQuality === q}
                onclick={() => setQuality(q as TtsQuality)}
              >
                {label} <small>{hint}</small>
              </button>
            {/each}
          </div>
        </div>
      {/if}
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
  .quality-pick {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .ql-hint {
    font-weight: 400;
    font-size: 0.72rem;
    color: var(--text-muted);
    margin-left: 0.3rem;
  }
  .quality-opts {
    display: flex;
    gap: 0.5rem;
  }
  .quality-opts button {
    flex: 1;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 0.55rem 0.5rem;
    font-size: 0.9rem;
    font-weight: 600;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    line-height: 1.2;
  }
  .quality-opts button small {
    font-weight: 400;
    font-size: 0.72rem;
    color: var(--text-muted);
  }
  .quality-opts button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .quality-opts button.active small {
    color: var(--accent);
  }
  .model-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    background: var(--warn-soft, #fdf0e6);
    border: 1px solid var(--warn, #b25b1b);
    color: var(--warn, #b25b1b);
    border-radius: var(--radius-sm);
    padding: 0.6rem 0.8rem;
    margin-bottom: 1rem;
  }
  .me-label {
    font-size: 0.85rem;
    font-weight: 600;
  }
  .me-retry {
    flex: none;
    border: 1px solid currentColor;
    background: transparent;
    color: inherit;
    border-radius: var(--radius-sm);
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
</style>
