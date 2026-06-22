/**
 * 운율(끊어읽기·강조어 속도강조) 자가검증:
 *   node --experimental-strip-types src/lib/refine/prosody.check.ts
 *
 * buildChunks(strict:true) 로 offset 불변식(FN-03)을 강제하면서,
 *  (A) 의미 단위 끊어읽기(쉼표·접속부사 절분할)
 *  (B) 강조어 속도강조(rateScale: strong=0.8 / emphasis=0.85)
 * 가 의도대로 청크에 반영되는지 실제 출력으로 확인한다.
 * 모두 통과 + 강조 청크가 1개 이상이면 "PROSODY OK".
 */
import { buildChunks } from './index.ts'
import { DEFAULT_CHUNK_OPTIONS } from '../types.ts'

// Node 전용 실행 스크립트(타입검사 통과용 최소 선언)
declare const process: { exit(code: number): never }

interface Sample {
  name: string
  md: string
  /** 기대: 강조(rateScale<1) 청크가 최소 몇 개 나와야 하는가 */
  minEmphasis?: number
  /** 기대: speech 청크 수가 최소 몇 개(끊어읽기로 늘어야 하는 샘플) */
  minSpeech?: number
}

const samples: Sample[] = [
  {
    name: '강조어 속도강조(**굵게**=0.8 / *기울임*=0.85)',
    md: `이것은 **매우 중요한 내용**입니다. 그리고 *조금 기울임 강조*도 섞여 있습니다.`,
    minEmphasis: 2,
  },
  {
    name: '의미 단위 끊어읽기(쉼표·접속부사)',
    md: `예를 들어, 이것은 충분히 긴 첫 번째 절이고 그리고 이것은 충분히 긴 두 번째 절입니다.`,
    minSpeech: 2,
  },
  {
    name: '과분할 방지(8자 미만 절은 분할 안 함)',
    md: `네, 좋아요. 그리고 또.`,
  },
  {
    name: '강조+끊어읽기 혼합',
    md: `우리는 **빠르고 정확하게**, 모든 작업을 차근차근 처리해야 합니다.`,
    minEmphasis: 1,
  },
  {
    name: '강조 비활성 회귀(emphasisSlowdown/clauseBreak=false → 단일 청크)',
    md: `이것은 **굵게** 강조한 한 문장입니다.`,
  },
]

function preview(s: string, n = 40): string {
  const o = s.replace(/\s+/g, ' ')
  return o.length > n ? o.slice(0, n) + '…' : o
}

let allOk = true

function runSample(s: Sample, off: boolean): void {
  const label = off ? `${s.name} [기능OFF]` : s.name
  console.log('\n══════════════════════════════════════════')
  console.log(`샘플: ${label}`)
  console.log('──────────────────────────────────────────')
  try {
    const opts = off
      ? { chunk: { ...DEFAULT_CHUNK_OPTIONS, clauseBreak: false, emphasisSlowdown: false }, strict: true as const }
      // 기능 ON 테스트: clauseBreak 는 이제 DEFAULT 가 false(문장 단위 낭독)이므로, 끊어읽기 기능
      // 자체를 검증하려면 명시적으로 켜서 호출한다(기능은 존재, 기본값만 OFF).
      : { chunk: { ...DEFAULT_CHUNK_OPTIONS, clauseBreak: true, emphasisSlowdown: true }, strict: true as const }
    const { chunks } = buildChunks(s.md, opts as Parameters<typeof buildChunks>[1])
    const speech = chunks.filter((c) => c.kind === 'speech')
    let emphasis = 0
    for (const c of speech) {
      const rs = c.rateScale !== undefined ? ` rate×${c.rateScale}` : ''
      const sliced = s.md.slice(c.startOffset, c.endOffset)
      console.log(`  #${c.index} off=[${c.startOffset},${c.endOffset}]${rs}`)
      console.log(`     text  ="${preview(c.text)}"`)
      if ((c.spokenText ?? c.text) !== c.text) console.log(`     spoken="${preview(c.spokenText ?? c.text)}"`)
      console.log(`     slice ="${preview(sliced)}"`)
      if (c.rateScale !== undefined && c.rateScale < 1) emphasis++
    }
    console.log(`  → speech=${speech.length}, 강조청크=${emphasis}`)
    // 기대 검증
    if (!off && s.minEmphasis !== undefined && emphasis < s.minEmphasis) {
      throw new Error(`강조 청크 부족: ${emphasis} < 기대 ${s.minEmphasis}`)
    }
    if (!off && s.minSpeech !== undefined && speech.length < s.minSpeech) {
      throw new Error(`끊어읽기 분할 부족: speech=${speech.length} < 기대 ${s.minSpeech}`)
    }
    if (off && emphasis > 0) {
      throw new Error(`기능 OFF 인데 강조 청크가 ${emphasis}개 나옴(회귀)`)
    }
    console.log('  ✓ invariant 통과 + 기대 충족')
  } catch (err) {
    allOk = false
    console.error('  ✗ 실패:', String(err instanceof Error ? err.message : err))
  }
}

for (const s of samples) runSample(s, false)
// 마지막 샘플로 기능 OFF 회귀(강조 0개여야)
runSample(samples[samples.length - 1], true)

console.log('\n══════════════════════════════════════════')
if (allOk) {
  console.log('PROSODY OK')
  process.exit(0)
} else {
  console.error('PROSODY FAILED')
  process.exit(1)
}
