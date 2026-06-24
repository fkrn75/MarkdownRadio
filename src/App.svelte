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
  import { buildChunks, REFINE_VERSION } from './lib/refine'
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
  import PlaylistQueue from './components/PlaylistQueue.svelte'
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
  // 재생 상태 단일 소스(청취·정독 공용). 엔진엔 pause 이벤트가 없어 함수 경유로만 갱신한다.
  // (Player 로컬 상태로 두면 탭 전환 시 이중화·불일치 위험 → App 이 소유.)
  let playing = $state(false)

  // ── 재생목록·반복·구간반복(A-B) 상태 ────────────────────────────────────
  // off=일반(끝나면 정지), one=한 문서 반복, ab=구간(A-B) 반복.
  type RepeatMode = 'off' | 'one' | 'ab'
  let repeatMode = $state<RepeatMode>('off')
  let abStart = $state<number | null>(null) // 구간 시작 청크 인덱스
  let abEnd = $state<number | null>(null) // 구간 끝 청크 인덱스
  let abPick = $state<'off' | 'a' | 'b'>('off') // 정독뷰에서 A/B 지점 찍기 모드
  let playQueue = $state<string[]>([]) // 재생목록 문서 id 순서(빈 배열=없음)
  let queueIndex = $state(0) // 현재 재생 중 큐 위치(0-based)
  let showQueue = $state(false) // 재생목록 순서 패널 토글(청취 탭)

  const docHash = $derived(curDoc ? hashText(curDoc.rawText) : '')

  // 재생목록 패널 표시용: 문서 id → {id,title}. 라이브러리에서 제목을 찾고, 없으면 id 표시.
  const queueItems = $derived(
    playQueue.map((id) => ({
      id,
      title: libraryStore.documents.find((d) => d.id === id)?.title ?? id,
    })),
  )

  // 엔진 위치를 App 에서 직접 추적(탭 전환과 무관하게 정독뷰 동기화 유지)
  // + 이어듣기: 위치 변화를 디바운스(2s)해 IndexedDB(StoredDocument.lastChunkIndex)에 저장.
  //   chunkChange는 매 청크마다 발생하므로 즉시 write 하지 않고 모아서 저장한다.
  let lastSaveTimer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    const onChange = (p: EnginePosition) => {
      currentChunkIndex = p.chunkIndex
      // 구간(A-B) 반복: 끝 청크에 도달하면 시작으로 되감는다(재생 중이면 자동 이어 발화).
      if (
        repeatMode === 'ab' &&
        abEnd != null &&
        abStart != null &&
        p.chunkIndex >= abEnd
      ) {
        engine.seekToChunk(abStart)
      }
      if (curDoc) {
        const id = curDoc.id
        const idx = p.chunkIndex
        clearTimeout(lastSaveTimer)
        lastSaveTimer = setTimeout(() => void updateLastChunkIndex(id, idx), 2000)
      }
    }
    // 재생 종료(end)는 App 에서 구독해 다음 동작을 결정한다. Player 는 탭 전환 시 언마운트되므로
    // 여기서 처리해야 정독 탭에서도 종료 후 버튼 상태가 정확히 반영된다.
    // 우선순위: 구간반복 → 한 문서 반복 → 재생목록 다음 문서 → 정지.
    const onEnd = () => {
      if (repeatMode === 'ab' && abStart != null) {
        engine.seekToChunk(abStart)
        engine.play()
        playing = true
        return
      }
      if (repeatMode === 'one') {
        engine.seekToChunk(0)
        engine.play()
        playing = true
        return
      }
      if (playQueue.length > 0 && queueIndex < playQueue.length - 1) {
        queueIndex++
        const nextId = playQueue[queueIndex]
        const nextDoc = libraryStore.documents.find((d) => d.id === nextId)
        if (nextDoc) {
          void openDocument(nextDoc).then(() => {
            engine.play()
            playing = true
          })
          return
        }
        // 다음 문서를 못 찾으면 그냥 정지(큐가 깨진 경우).
      }
      playing = false
    }
    engine.on('chunkChange', onChange)
    engine.on('end', onEnd)
    return () => {
      engine.off('chunkChange', onChange)
      engine.off('end', onEnd)
      clearTimeout(lastSaveTimer)
    }
  })

  /** 재생/일시정지 토글(청취·정독 공용 단일 소스). */
  function togglePlay(): void {
    if (playing) {
      engine.pause()
      playing = false
    } else {
      engine.play()
      playing = true
    }
  }

  /** 정독뷰: 더블클릭/문장 → 그 청크부터 즉시 재생(seek + play). */
  function seekAndPlay(i: number): void {
    engine.seekToChunk(i)
    engine.play()
    playing = true
  }

  /**
   * 정독뷰 단클릭(onSeek): 평소엔 그 청크로 seek.
   * 단, A-B 찍기 모드(abPick)면 클릭한 청크를 A→B 순서로 구간 양 끝에 기록한다.
   *  - 'a' 상태: 시작(abStart) 지정 후 'b' 대기.
   *  - 'b' 상태: 끝 지정 → 시작>끝이면 스왑 → repeatMode='ab' 확정.
   */
  function handleSeek(i: number): void {
    if (abPick === 'a') {
      abStart = i
      abPick = 'b'
    } else if (abPick === 'b') {
      let s = abStart ?? i
      let e = i
      if (e < s) [s, e] = [e, s]
      abStart = s
      abEnd = e
      abPick = 'off'
      repeatMode = 'ab'
    } else {
      engine.seekToChunk(i)
    }
  }

  /** 한 문서 반복 토글(청취·정독 공용). 켜면 A-B 구간은 정리. */
  function onToggleRepeatOne(): void {
    repeatMode = repeatMode === 'one' ? 'off' : 'one'
    if (repeatMode === 'one') {
      abStart = null
      abEnd = null
      abPick = 'off'
    }
  }

  /** 정독뷰: A-B 구간 지정 시작(시작 찍기 모드 진입). repeatMode는 B 확정 때 'ab'. */
  function onStartAbPick(): void {
    abStart = null
    abEnd = null
    abPick = 'a'
  }

  /** A-B 구간 해제(정독뷰). */
  function onClearAb(): void {
    if (repeatMode === 'ab') repeatMode = 'off'
    abStart = null
    abEnd = null
    abPick = 'off'
  }

  /**
   * 청취화면 A-B 버튼(현재 청크 기준 1버튼): 해제 → A 지정 → B 지정(=확정) 순환.
   *  - 이미 ab면: 해제(off).
   *  - abStart 없음: 현재 청크를 시작으로.
   *  - abStart 있음: 현재 청크를 끝으로(시작>끝이면 스왑) → repeatMode='ab' 확정.
   */
  function onAbButton(): void {
    if (repeatMode === 'ab') {
      repeatMode = 'off'
      abStart = null
      abEnd = null
      return
    }
    if (abStart === null) {
      abStart = currentChunkIndex
      return
    }
    let s = abStart
    let e = currentChunkIndex
    if (e < s) [s, e] = [e, s]
    abStart = s
    abEnd = e
    repeatMode = 'ab'
  }

  /** 재생목록(여러 문서 순차 재생): 큐 세팅 후 첫 문서를 열어 자동 재생. */
  async function handlePlaylist(ids: string[]): Promise<void> {
    if (!ids.length) return
    playQueue = ids
    queueIndex = 0
    const doc = libraryStore.documents.find((d) => d.id === ids[0])
    if (doc) {
      await openDocument(doc)
      engine.play()
      playing = true
    }
  }

  // ── 재생목록 순서 조작(▲▼·제거·점프) ───────────────────────────────────
  // ⚠️ 핵심 불변식: reorder/remove 는 배열과 queueIndex 만 바꾼다(engine/openDocument 미호출).
  //    현재 재생 중인 문서가 끊기지 않아야 하므로 오직 qJump 만 문서를 전환한다.

  /** ▲ i번째 항목을 한 칸 위로. 현재 재생 위치(queueIndex)는 교환에 맞춰 보정. */
  function qMoveUp(i: number): void {
    if (i <= 0) return
    const a = [...playQueue]
    ;[a[i - 1], a[i]] = [a[i], a[i - 1]]
    playQueue = a
    if (queueIndex === i) queueIndex = i - 1
    else if (queueIndex === i - 1) queueIndex = i
  }

  /** ▼ i번째 항목을 한 칸 아래로. queueIndex 보정 동일. */
  function qMoveDown(i: number): void {
    if (i >= playQueue.length - 1) return
    const a = [...playQueue]
    ;[a[i + 1], a[i]] = [a[i], a[i + 1]]
    playQueue = a
    if (queueIndex === i) queueIndex = i + 1
    else if (queueIndex === i + 1) queueIndex = i
  }

  /** ✕ i번째 항목 제거. 현재 재생 항목은 제거하지 않는다(패널에서도 disabled). */
  function qRemove(i: number): void {
    if (i === queueIndex) return // 현재 재생 항목은 제거 안 함
    const a = [...playQueue]
    a.splice(i, 1)
    playQueue = a
    if (i < queueIndex) queueIndex -= 1 // 앞 항목 제거 시 현재 위치 보정
  }

  /** ▶ i번째 항목으로 점프(문서 전환 + 재생). 유일하게 engine/openDocument 를 호출. */
  function qJump(i: number): void {
    if (i < 0 || i >= playQueue.length) return
    queueIndex = i
    const doc = libraryStore.documents.find((d) => d.id === playQueue[i])
    if (doc) void openDocument(doc).then(() => { engine.play(); playing = true })
  }

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
    playing = false
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
    // 새 문서이므로 A-B 구간만 정리한다(이전 문서의 청크 인덱스라 무의미).
    // ⚠️ repeatMode/playQueue/queueIndex 는 호출자(재생목록 onEnd·handlePlaylist)가
    //    관리한다. 여기서 리셋하면 재생목록 다음 곡으로 넘어갈 때 큐가 끊긴다.
    abStart = null
    abEnd = null
    abPick = 'off'
    // 캐시된 청크가 있으면 재정제 생략, 없으면 즉석 정제(사용자 정제/청크 설정 반영).
    // ⚠️ 향후 정제/청크 옵션을 바꾸는 설정 UI를 추가하면, 캐시(doc.chunks)가 옛 옵션으로
    //    만들어졌을 수 있으니 옵션 해시 비교로 캐시 무효화(재빌드)가 필요하다.
    // 캐시된 청크가 있고, 그 청크를 만든 정제 로직 버전이 현재(REFINE_VERSION)와 같을 때만 재사용.
    // 코드(발음·운율 등)가 업데이트되면 버전이 올라가 옛 캐시를 버리고 자동 재정제한다.
    const cacheValid =
      !!doc.chunks && doc.chunks.length > 0 && doc.refineVersion === REFINE_VERSION
    let ready: Chunk[]
    if (cacheValid) {
      ready = doc.chunks!
    } else {
      ready = buildChunks(doc.rawText, {
        refine: settingsStore.value.refine,
        chunk: settingsStore.value.chunk,
      }).chunks
      // 재정제 결과를 캐시에 반영(다음부턴 재정제 생략). 기존 문서가 새 발음/운율을 갖게 된다.
      doc.chunks = ready
      doc.refineVersion = REFINE_VERSION
      doc.updatedAt = Date.now()
      await libraryStore.upsert(doc)
    }
    chunks = ready
    const h = hashText(doc.rawText)
    await engine.load(chunks)
    // 재생 계측(chunk_play_*, jump_resolved)이 올바른 docId/docHash 로 적재되게 컨텍스트 주입
    engine.setDocContext?.({ docId: doc.id, docHash: h })
    bookmarks = await listBookmarks(doc.id)
    // 이어듣기: 마지막으로 듣던 청크로 복원(없으면 0). 위치만 맞추고 재생은 사용자 조작에 맡긴다.
    // ⚠️ 단, 끝까지 들어 lastChunkIndex 가 '마지막 청크'면 0(처음)으로 되돌린다.
    //    안 그러면 재진입 시 맨 끝 청크에서 시작 → 재생하면 즉시 종료되어 '음성이 안 나온다'고
    //    체감된다(끝낸 문서는 처음부터 다시 듣는 게 자연스럽다). chunks 는 위에서 이미 세팅됨.
    const last = doc.lastChunkIndex ?? 0
    const resume = last > 0 && last < chunks.length - 1 ? last : 0
    currentChunkIndex = resume
    if (resume > 0) engine.seekToChunk(resume)
    playing = false // 새 문서는 정지 상태로 진입(재생은 사용자 조작)
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
      refineVersion: REFINE_VERSION,
      createdAt: now,
      updatedAt: now,
    }
    await libraryStore.upsert(doc)
    await openDocument(doc)
  }

  async function handleSelect(id: string) {
    // 라이브러리 단클릭 = 단일 재생: 진행 중이던 재생목록을 비운다.
    playQueue = []
    queueIndex = 0
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
    playing = false
    // 홈으로 나갈 때 반복·구간·재생목록 상태를 전부 초기화한다.
    repeatMode = 'off'
    abStart = null
    abEnd = null
    abPick = 'off'
    playQueue = []
    queueIndex = 0
    showQueue = false
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
      <span class="me-label">{modelError}</span>
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
      <Library onselect={handleSelect} onplaylist={handlePlaylist} />
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
        {#if showQueue && playQueue.length > 1}
          <PlaylistQueue
            items={queueItems}
            currentIndex={queueIndex}
            onMoveUp={qMoveUp}
            onMoveDown={qMoveDown}
            onRemove={qRemove}
            onJump={qJump}
            onClose={() => (showQueue = false)}
          />
        {/if}
        <Player
          {chunks}
          {engine}
          {playing}
          onTogglePlay={togglePlay}
          docId={curDoc.id}
          {docHash}
          onBookmark={handleBookmark}
          {repeatMode}
          {abStart}
          {abEnd}
          queuePos={playQueue.length > 1 ? { index: queueIndex, total: playQueue.length } : null}
          {onToggleRepeatOne}
          {onAbButton}
          queueLen={playQueue.length}
          onToggleQueue={() => (showQueue = !showQueue)}
        />
      {:else if tab === 'read'}
        <ReadingView
          rawText={curDoc.rawText}
          {chunks}
          {bookmarks}
          {currentChunkIndex}
          {jumpOffset}
          {playing}
          onTogglePlay={togglePlay}
          onSeek={handleSeek}
          onSeekPlay={seekAndPlay}
          docId={curDoc.id}
          {docHash}
          {repeatMode}
          {abStart}
          {abEnd}
          {abPick}
          {onToggleRepeatOne}
          {onStartAbPick}
          {onClearAb}
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
