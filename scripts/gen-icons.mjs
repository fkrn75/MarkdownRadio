// 일회성 PWA 아이콘 생성 스크립트
// 네이비(#2b4c8c) 배경 + 흰색 라디오 전파(물결) 심볼을 SVG 로 디자인한 뒤
// sharp 로 192/512/maskable-192 PNG 를 public/icons/ 에 렌더한다.
//
// 실행: node scripts/gen-icons.mjs
// (산출 PNG 만 public/icons/ 에 남고, 이 스크립트는 scripts/ 에 보존)

import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'icons')

const NAVY = '#2b4c8c'
const NAVY_DARK = '#1d3a6e' // 그라데이션 하단
const WHITE = '#ffffff'

// 라디오 전파 심볼 SVG 생성
// size: 뷰포트 한 변 px
// maskable: true 면 안전영역(가장자리 20% 여백) 적용 → 심볼을 중앙 60% 영역에 배치
function buildSvg(size, maskable) {
  // maskable 은 가장자리 20% 가 잘릴 수 있으므로 콘텐츠를 중앙 60% 안에 둔다.
  const contentScale = maskable ? 0.6 : 0.78
  const cx = size / 2
  const cy = size / 2

  // 송신점(원) + 동심 호(arc) 3개로 전파를 표현. 좌하단→우상단으로 퍼지는 구도.
  const R = (size / 2) * contentScale
  const dotR = R * 0.16
  const arcRs = [R * 0.42, R * 0.66, R * 0.9]
  const stroke = R * 0.13

  // 송신점을 좌하단으로 이동시켜 전파가 우상단으로 퍼지는 구도
  const ox = cx - R * 0.34
  const oy = cy + R * 0.34

  // 우상단을 향하는 부채꼴 호 path (시작각 -78도 ~ 끝각 12도)
  const arcPath = (r) => {
    const a0 = (-78 * Math.PI) / 180
    const a1 = (12 * Math.PI) / 180
    const x0 = ox + r * Math.cos(a0)
    const y0 = oy + r * Math.sin(a0)
    const x1 = ox + r * Math.cos(a1)
    const y1 = oy + r * Math.sin(a1)
    return 'M ' + x0.toFixed(2) + ' ' + y0.toFixed(2) +
      ' A ' + r.toFixed(2) + ' ' + r.toFixed(2) + ' 0 0 1 ' +
      x1.toFixed(2) + ' ' + y1.toFixed(2)
  }

  const arcs = arcRs
    .map((r, i) =>
      '<path d="' + arcPath(r) + '" fill="none" stroke="' + WHITE +
      '" stroke-width="' + stroke.toFixed(2) +
      '" stroke-linecap="round" opacity="' + (1 - i * 0.12).toFixed(2) + '"/>')
    .join('\n    ')

  // 배경: 둥근 사각형(일반) / 꽉 찬 사각형(maskable - OS 가 모양 마스킹)
  const radius = maskable ? 0 : size * 0.22
  const bg = '<rect x="0" y="0" width="' + size + '" height="' + size +
    '" rx="' + radius + '" ry="' + radius + '" fill="url(#g)"/>'

  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
    '" viewBox="0 0 ' + size + ' ' + size + '">\n' +
    '  <defs>\n' +
    '    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">\n' +
    '      <stop offset="0" stop-color="' + NAVY + '"/>\n' +
    '      <stop offset="1" stop-color="' + NAVY_DARK + '"/>\n' +
    '    </linearGradient>\n' +
    '  </defs>\n' +
    '  ' + bg + '\n' +
    '  <g>\n' +
    '    ' + arcs + '\n' +
    '    <circle cx="' + ox.toFixed(2) + '" cy="' + oy.toFixed(2) + '" r="' +
    dotR.toFixed(2) + '" fill="' + WHITE + '"/>\n' +
    '  </g>\n' +
    '</svg>'
}

async function render(size, maskable, filename) {
  const svg = buildSvg(size, maskable)
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  const dest = join(OUT_DIR, filename)
  await writeFile(dest, png)
  console.log('  OK ' + filename + '  (' + png.length + ' bytes)')
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  console.log('PWA 아이콘 생성 ->', OUT_DIR)
  await render(192, false, 'icon-192.png')
  await render(512, false, 'icon-512.png')
  await render(192, true, 'icon-maskable-192.png')
  console.log('완료.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
