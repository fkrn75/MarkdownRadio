<script lang="ts">
  /**
   * 마크다운(mdast) 노드 1개를 DOM 으로 **직접** 렌더하는 재귀 컴포넌트.
   *
   * 폐루프 핵심: 각 요소에 원문 오프셋(node.position.*.offset)을 data-start/data-end 로 부여한다.
   * 이 오프셋은 Chunk.startOffset/endOffset 과 같은 좌표계라, 상위 ReadingView 가 offset 범위로
   * 해당 DOM 을 찾아 하이라이트/점프할 수 있다(매핑 재구성·시간 역산 없음).
   *
   * XSS 안전:
   *  - `{@html}` 를 일절 쓰지 않는다. 모든 텍스트는 Svelte 가 자동 이스케이프한다.
   *  - raw HTML(mdast `html` 노드)도 **텍스트로** 출력 → <script> 등은 무해한 문자열이 된다.
   *  - 링크 href / 이미지 src 는 isSafeUrl() 통과한 것만 사용(아니면 href 없는 span / 텍스트로 폴백).
   *
   * 자기 자신을 children 렌더에 재귀 사용(<svelte:self>). 한 번 파싱한 트리를 그대로 그린다.
   */
  import type {
    RootContent,
    PhrasingContent,
    Root,
    TableCell,
  } from 'mdast'
  import { nodeOffsets, isSafeUrl, isSafeImageSrc, parseImgTag } from '../lib/markdown'
  import Self from './MarkdownNode.svelte'
  import MermaidDiagram from './MermaidDiagram.svelte'

  interface Props {
    node: Root | RootContent | PhrasingContent
    /** 표 셀 정렬(부모 table 에서 열 인덱스로 내려줌). th/td 에만 의미. */
    align?: 'left' | 'right' | 'center' | null
  }
  let { node, align = null }: Props = $props()

  // data-start/data-end (position 있을 때만 — 없으면 NaN 방지 위해 부여 안 함)
  const off = $derived(nodeOffsets(node as { position?: never }))

  // 자식 노드 배열(없으면 빈 배열). 타입별 분기에서 공통 사용.
  const children = $derived(
    'children' in node && Array.isArray(node.children) ? node.children : [],
  )

  // 이미지 로드 실패(로컬/상대경로 등 원본 부재) 시 placeholder 로 폴백.
  let imgFailed = $state(false)

  /** 이미지 URL 에서 파일명만 추출(placeholder 표시용). data: 는 빈 문자열. */
  function imageName(url: string | null | undefined): string {
    if (!url || url.startsWith('data:')) return ''
    const clean = url.split(/[?#]/)[0]
    const name = clean.split(/[\\/]/).pop() ?? ''
    return decodeURIComponent(name)
  }
</script>

<!--
  노드 타입별 렌더. data-start/data-end 는 off 가 있을 때만(spread).
  Svelte 에서 조건부 속성 spread 를 쓰려고 off 를 {...(off ? {...} : {})} 로 부여.
-->
{#if node.type === 'root'}
  {#each children as child, i (i)}
    <Self node={child} />
  {/each}
{:else if node.type === 'text'}
  {node.value}
{:else if node.type === 'html'}
  <!-- raw HTML: <img> 태그만 안전 파싱해 이미지로(src/alt 추출 + isSafeImageSrc 검사),
       그 외 raw HTML 은 텍스트로 이스케이프(XSS 차단). -->
  {@const htmlImg = parseImgTag(node.value)}
  {#if htmlImg && isSafeImageSrc(htmlImg.src) && !imgFailed}
    <!--
      이미지 가상화: src 를 초기에 비우고 원본을 data-src 에 보관한다(요소·data-start/end 는 항상 DOM 유지).
      ReadingView 의 IntersectionObserver 가 뷰포트(+마진) 진입 시 src 복원, 이탈 시 다시 비운다.
      src 미설정 img 는 onerror 를 발火하지 않아(IO 가 진짜 src 를 넣은 뒤의 실패만 imgFailed) base64 디코드/메모리를 절감.
      virt-img 클래스의 min-height 로 로드 전 height 0 붕괴(레이아웃 점프) 방지.
    -->
    <img
      class="virt-img"
      data-src={htmlImg.src}
      alt={htmlImg.alt}
      loading="lazy"
      onerror={() => (imgFailed = true)}
      data-start={off?.start}
      data-end={off?.end}
    />
  {:else if htmlImg}
    <!-- 차단되었거나 로드 실패: 캡션 placeholder -->
    <span class="img-fallback" data-start={off?.start} data-end={off?.end}
      >🖼 {htmlImg.alt || imageName(htmlImg.src) || '이미지'}</span
    >
  {:else}
    {node.value}
  {/if}
{:else if node.type === 'heading'}
  {#if node.depth === 1}
    <h1 data-start={off?.start} data-end={off?.end}>
      {#each children as child, i (i)}<Self node={child} />{/each}
    </h1>
  {:else if node.depth === 2}
    <h2 data-start={off?.start} data-end={off?.end}>
      {#each children as child, i (i)}<Self node={child} />{/each}
    </h2>
  {:else if node.depth === 3}
    <h3 data-start={off?.start} data-end={off?.end}>
      {#each children as child, i (i)}<Self node={child} />{/each}
    </h3>
  {:else if node.depth === 4}
    <h4 data-start={off?.start} data-end={off?.end}>
      {#each children as child, i (i)}<Self node={child} />{/each}
    </h4>
  {:else if node.depth === 5}
    <h5 data-start={off?.start} data-end={off?.end}>
      {#each children as child, i (i)}<Self node={child} />{/each}
    </h5>
  {:else}
    <h6 data-start={off?.start} data-end={off?.end}>
      {#each children as child, i (i)}<Self node={child} />{/each}
    </h6>
  {/if}
{:else if node.type === 'paragraph'}
  <p data-start={off?.start} data-end={off?.end}>
    {#each children as child, i (i)}<Self node={child} />{/each}
  </p>
{:else if node.type === 'strong'}
  <strong data-start={off?.start} data-end={off?.end}>
    {#each children as child, i (i)}<Self node={child} />{/each}
  </strong>
{:else if node.type === 'emphasis'}
  <em data-start={off?.start} data-end={off?.end}>
    {#each children as child, i (i)}<Self node={child} />{/each}
  </em>
{:else if node.type === 'delete'}
  <del data-start={off?.start} data-end={off?.end}>
    {#each children as child, i (i)}<Self node={child} />{/each}
  </del>
{:else if node.type === 'inlineCode'}
  <code class="inline" data-start={off?.start} data-end={off?.end}>{node.value}</code>
{:else if node.type === 'code'}
  {#if node.lang === 'mermaid'}
    <!-- mermaid 도식: 다이어그램으로 렌더(lazy import) -->
    <MermaidDiagram code={node.value} offStart={off?.start} offEnd={off?.end} />
  {:else}
    <!-- 코드블록: 언어 라벨 + 가로스크롤 pre. 텍스트로만 출력(하이라이트 없음) -->
    <div class="codeblock" data-start={off?.start} data-end={off?.end}>
      {#if node.lang}<span class="lang">{node.lang}</span>{/if}
      <pre><code>{node.value}</code></pre>
    </div>
  {/if}
{:else if node.type === 'blockquote'}
  <blockquote data-start={off?.start} data-end={off?.end}>
    {#each children as child, i (i)}<Self node={child} />{/each}
  </blockquote>
{:else if node.type === 'list'}
  {#if node.ordered}
    <ol start={node.start ?? 1} data-start={off?.start} data-end={off?.end}>
      {#each children as child, i (i)}<Self node={child} />{/each}
    </ol>
  {:else}
    <ul data-start={off?.start} data-end={off?.end}>
      {#each children as child, i (i)}<Self node={child} />{/each}
    </ul>
  {/if}
{:else if node.type === 'listItem'}
  {#if node.checked === true || node.checked === false}
    <!-- GFM task list 항목: 체크박스(비활성) + 내용 -->
    <li class="task" data-start={off?.start} data-end={off?.end}>
      <input type="checkbox" checked={node.checked} disabled />
      <span class="task-body">
        {#each children as child, i (i)}<Self node={child} />{/each}
      </span>
    </li>
  {:else}
    <li data-start={off?.start} data-end={off?.end}>
      {#each children as child, i (i)}<Self node={child} />{/each}
    </li>
  {/if}
{:else if node.type === 'table'}
  <!-- 표: 모바일 가로스크롤 래퍼. 첫 행=thead(th), 이후=tbody(td). align 을 열 인덱스로 셀에 적용 -->
  {@const rows = node.children}
  <div class="table-wrap" data-start={off?.start} data-end={off?.end}>
    <table>
      {#if rows.length > 0}
        {@const headOff = nodeOffsets(rows[0])}
        <thead>
          <tr data-start={headOff?.start} data-end={headOff?.end}>
            {#each rows[0].children as cell, ci (ci)}
              {@const cellOff = nodeOffsets(cell)}
              {@const a = node.align?.[ci] ?? null}
              <th style={a ? `text-align:${a}` : undefined} data-start={cellOff?.start} data-end={cellOff?.end}>
                {#each cell.children as child, i (i)}<Self node={child} />{/each}
              </th>
            {/each}
          </tr>
        </thead>
      {/if}
      <tbody>
        {#each rows.slice(1) as row, ri (ri)}
          {@const rowOff = nodeOffsets(row)}
          <tr data-start={rowOff?.start} data-end={rowOff?.end}>
            {#each row.children as cell, ci (ci)}
              {@const cellOff = nodeOffsets(cell)}
              {@const a = node.align?.[ci] ?? null}
              <td style={a ? `text-align:${a}` : undefined} data-start={cellOff?.start} data-end={cellOff?.end}>
                {#each cell.children as child, i (i)}<Self node={child} />{/each}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else if node.type === 'tableCell'}
  <!-- 표 셀은 위 table 분기에서 th/td 로 직접 렌더하므로 여기로 오면 안전망(td)으로만 -->
  <td style={align ? `text-align:${align}` : undefined} data-start={off?.start} data-end={off?.end}>
    {#each (node as TableCell).children as child, i (i)}<Self node={child} />{/each}
  </td>
{:else if node.type === 'image'}
  {#if isSafeImageSrc(node.url) && !imgFailed}
    <!-- 이미지 가상화: src 비우고 data-src 에 원본 보관(상단 html-img 주석과 동일 전략). -->
    <img
      class="virt-img"
      data-src={node.url}
      alt={node.alt ?? ''}
      title={node.title ?? undefined}
      loading="lazy"
      onerror={() => (imgFailed = true)}
      data-start={off?.start}
      data-end={off?.end}
    />
  {:else}
    <!-- 차단(비허용 스킴)되었거나 로드 실패(로컬/상대경로 원본 부재): 캡션 placeholder -->
    <span class="img-fallback" data-start={off?.start} data-end={off?.end}
      >🖼 {node.alt || imageName(node.url) || '이미지'}</span
    >
  {/if}
{:else if node.type === 'link'}
  {#if isSafeUrl(node.url)}
    <a href={node.url} target="_blank" rel="noopener noreferrer nofollow" data-start={off?.start} data-end={off?.end}>
      {#each children as child, i (i)}<Self node={child} />{/each}
    </a>
  {:else}
    <!-- 안전하지 않은 href: 링크 없이 텍스트만(클릭 불가) -->
    <span class="link-fallback" data-start={off?.start} data-end={off?.end}>
      {#each children as child, i (i)}<Self node={child} />{/each}
    </span>
  {/if}
{:else if node.type === 'thematicBreak'}
  <hr data-start={off?.start} data-end={off?.end} />
{:else if node.type === 'footnoteReference'}
  <sup class="fn-ref" data-start={off?.start} data-end={off?.end}>[{node.identifier}]</sup>
{:else if node.type === 'footnoteDefinition'}
  <div class="fn-def" data-start={off?.start} data-end={off?.end}>
    <span class="fn-id">[{node.identifier}]</span>
    {#each children as child, i (i)}<Self node={child} />{/each}
  </div>
{:else if 'children' in node}
  <!-- 미분류 컨테이너 노드: 자식만 이어서 렌더(누락 방지) -->
  {#each children as child, i (i)}<Self node={child} />{/each}
{:else if 'value' in node}
  <!-- 미분류 리프: 값 텍스트로 -->
  {(node as { value: string }).value}
{/if}
