<script lang="ts">
  /**
   * FN-01 · 문서 입력
   *  - 파일 업로드: .md/.markdown/.txt (드래그앤드롭 + 파일 선택 버튼)
   *  - 텍스트 붙여넣기: textarea 입력 → "읽기" 버튼
   *  - 문서명 자동 추출: 파일명 / 첫 '# 헤더' / 첫 줄 30자
   *  - 결과를 onload(doc: RawDocument)로 상위에 전달. 빈/비지원 파일은 onerror로 안내.
   */
  import type { RawDocument } from '../lib/types'
  import { genId } from '../lib/stores/id'

  interface Props {
    /** 입력 완료 → RawDocument 전달(상위가 정제·청크·저장 담당). */
    onload: (doc: RawDocument) => void
    /** 엣지케이스 메시지(빈 파일·비지원 형식 등). 없으면 내부 인라인 표시. */
    onerror?: (message: string) => void
  }

  let { onload, onerror }: Props = $props()

  // 붙여넣기 textarea 내용
  let pasteText = $state('')
  // 드래그 오버 시각 피드백
  let dragOver = $state(false)
  // 내부 인라인 에러(onerror 미지정 시 표시)
  let localError = $state('')
  // 숨긴 파일 input 참조
  let fileInput: HTMLInputElement | undefined = $state()

  /** 지원하는 확장자(소문자) */
  const ALLOWED_EXT = ['.md', '.markdown', '.txt']
  /** 5MB 초과 시 확인(FN-01 SHOULD) */
  const WARN_BYTES = 5 * 1024 * 1024

  function reportError(msg: string): void {
    if (onerror) onerror(msg)
    else localError = msg
  }

  /**
   * 원문에서 문서명 추출:
   *  1) explicitTitle(파일명) 우선
   *  2) 첫 번째 '# 헤더'
   *  3) 첫 비어있지 않은 줄의 30자
   */
  function deriveTitle(text: string, explicitTitle?: string): string {
    if (explicitTitle && explicitTitle.trim()) return explicitTitle.trim()
    const lines = text.split(/\r?\n/)
    // 첫 ATX 헤더(# ~ ######)
    for (const line of lines) {
      const m = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
      if (m && m[1].trim()) return m[1].trim().slice(0, 60)
    }
    // 첫 비어있지 않은 줄 30자
    for (const line of lines) {
      const t = line.trim()
      if (t) return t.slice(0, 30)
    }
    return '제목 없는 문서'
  }

  /** 빈/공백 검사(FN-01: 빈 파일/공백만 → 중단). */
  function isBlank(text: string): boolean {
    return text.trim().length === 0
  }

  /** 공통: 원문 텍스트 → RawDocument 생성 후 onload. */
  function emit(rawText: string, sourceType: RawDocument['sourceType'], explicitTitle?: string): void {
    if (isBlank(rawText)) {
      reportError('내용이 없습니다')
      return
    }
    localError = ''
    const doc: RawDocument = {
      id: genId(),
      title: deriveTitle(rawText, explicitTitle),
      rawText,
      sourceType,
      createdAt: Date.now(),
    }
    onload(doc)
  }

  /** 확장자 허용 여부(대소문자 무시). */
  function hasAllowedExt(name: string): boolean {
    const lower = name.toLowerCase()
    return ALLOWED_EXT.some((ext) => lower.endsWith(ext))
  }

  /** 파일 1개 처리(확장자 검사 → UTF-8 디코딩 → emit). */
  function handleFile(file: File): void {
    if (!hasAllowedExt(file.name)) {
      reportError('MD/TXT만 지원합니다')
      return
    }
    if (file.size > WARN_BYTES) {
      // 5MB 초과: 확인 후 진행(하드 상한은 없음 — FN-01)
      const ok = confirm(
        `큰 파일입니다(${(file.size / 1024 / 1024).toFixed(1)}MB). 청크가 많아질 수 있어요. 계속할까요?`,
      )
      if (!ok) return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      // 파일명에서 확장자 제거해 제목 후보로
      const baseName = file.name.replace(/\.(md|markdown|txt)$/i, '')
      emit(text, 'file', baseName)
    }
    reader.onerror = () => {
      reportError('지원하지 않는 인코딩이거나 파일을 읽을 수 없습니다')
    }
    reader.readAsText(file, 'utf-8')
  }

  // ── 이벤트 핸들러 ───────────────────────────────────────────
  function onFileInputChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) handleFile(file)
    // 같은 파일 재선택 가능하도록 초기화
    input.value = ''
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    dragOver = false
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }

  function onDragOver(e: DragEvent): void {
    e.preventDefault()
    dragOver = true
  }

  function onDragLeave(): void {
    dragOver = false
  }

  function submitPaste(): void {
    emit(pasteText, 'paste')
  }

  function clearPaste(): void {
    pasteText = ''
    localError = ''
  }
</script>

<div class="uploader">
  <!-- 드롭존 + 파일 선택 -->
  <div
    class="dropzone"
    class:over={dragOver}
    role="button"
    tabindex="0"
    aria-label="파일을 끌어다 놓거나 클릭해 선택"
    ondrop={onDrop}
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    onclick={() => fileInput?.click()}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        fileInput?.click()
      }
    }}
  >
    <span class="dz-icon" aria-hidden="true">⬆</span>
    <p class="dz-title">파일을 끌어다 놓거나 클릭해 선택</p>
    <p class="dz-sub">.md · .markdown · .txt</p>
    <input
      bind:this={fileInput}
      type="file"
      accept=".md,.markdown,.txt,text/markdown,text/plain"
      class="hidden-file"
      onchange={onFileInputChange}
    />
  </div>

  <div class="divider"><span>또는 붙여넣기</span></div>

  <!-- 붙여넣기 -->
  <div class="paste">
    <textarea
      bind:value={pasteText}
      placeholder="마크다운 또는 텍스트를 여기에 붙여넣으세요…"
      rows="6"
      aria-label="텍스트 붙여넣기"
    ></textarea>
    <div class="paste-actions">
      {#if pasteText.trim()}
        <button type="button" class="btn ghost" onclick={clearPaste}>지우기</button>
      {/if}
      <button type="button" class="btn primary" onclick={submitPaste} disabled={!pasteText.trim()}>
        읽기
      </button>
    </div>
  </div>

  {#if localError}
    <p class="error" role="alert">{localError}</p>
  {/if}
</div>

<style>
  .uploader {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .dropzone {
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 2rem 1rem;
    text-align: center;
    transition: border-color 0.15s, background 0.15s;
    box-shadow: var(--shadow);
  }
  .dropzone.over {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .dz-icon {
    display: inline-block;
    font-size: 1.6rem;
    color: var(--accent);
  }
  .dz-title {
    margin: 0.5rem 0 0.2rem;
    font-weight: 600;
  }
  .dz-sub {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .hidden-file {
    display: none;
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .paste {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  textarea {
    width: 100%;
    resize: vertical;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    padding: 0.75rem;
    font-family: inherit;
    font-size: 0.95rem;
    line-height: 1.6;
  }
  textarea:focus-visible {
    border-color: var(--accent);
    outline: none;
  }
  .paste-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .btn {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: 0.5rem 1.1rem;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .btn.primary {
    background: var(--accent);
    color: #fff;
  }
  .btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.ghost {
    background: transparent;
    border-color: var(--border);
    color: var(--text-muted);
  }

  .error {
    margin: 0;
    color: var(--warn);
    background: var(--warn-soft);
    border-radius: var(--radius-sm);
    padding: 0.6rem 0.8rem;
    font-size: 0.9rem;
  }
</style>
