<script module lang="ts">
  // mermaid 렌더 노드 ID 유니크 카운터(Math.random 미사용 — 전역 증가).
  let _mmdCounter = 0
</script>

<script lang="ts">
  /**
   * mermaid 다이어그램 렌더(정독뷰 도식).
   *
   * lazy: mermaid 는 dynamic import 라 정독뷰에 mermaid 코드블록이 있을 때만 로드된다
   *   → 메인 번들/콜드스타트에 영향 0(온디바이스 TTS 본체와 분리된 청크).
   * 보안: securityLevel:'strict' 로 다이어그램 라벨의 HTML/스크립트를 sanitize. 생성된 SVG 만
   *   host.innerHTML 로 삽입한다(마크다운 렌더의 "{@html} 0" 원칙의 유일한 예외 — mermaid 가
   *   strict 모드로 신뢰 가능한 SVG 를 만든다).
   * 실패(문법 오류 등) 시 원본 코드를 코드블록으로 폴백한다.
   * offset(data-start/end)은 다른 노드와 좌표계를 맞추기 위해 그대로 부여(폐루프 일관성).
   */
  interface Props {
    code: string
    offStart?: number
    offEnd?: number
  }
  let { code, offStart, offEnd }: Props = $props()

  let host: HTMLDivElement | undefined = $state()
  let failed = $state(false)

  $effect(() => {
    const src = code
    let cancelled = false
    failed = false
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default
        const dark =
          window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dark ? 'dark' : 'default',
        })
        _mmdCounter += 1
        const { svg } = await mermaid.render(`mmd-${_mmdCounter}`, src)
        if (!cancelled && host) host.innerHTML = svg
      } catch {
        // 문법 오류 등 → 코드 폴백
        if (!cancelled) failed = true
      }
    })()
    return () => {
      cancelled = true
    }
  })
</script>

{#if failed}
  <!-- 렌더 실패: 원본 mermaid 코드를 코드블록으로 -->
  <div class="codeblock" data-start={offStart} data-end={offEnd}>
    <span class="lang">mermaid</span>
    <pre><code>{code}</code></pre>
  </div>
{:else}
  <div
    class="mermaid-diagram"
    bind:this={host}
    data-start={offStart}
    data-end={offEnd}
  ></div>
{/if}

<style>
  .mermaid-diagram {
    margin: 1em 0;
    text-align: center;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .mermaid-diagram :global(svg) {
    max-width: 100%;
    height: auto;
  }
</style>
