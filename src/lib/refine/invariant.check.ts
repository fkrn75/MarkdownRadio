/**
 * 자가검증: node --experimental-strip-types src/lib/refine/invariant.check.ts
 * (package.json 의 `npm run test:invariant`)
 *
 * 헤더·강조·코드블록·링크·표·리스트·한국어 문장이 섞인 샘플로 buildChunks 를 돌려
 *  (a) assertChunkInvariant 통과
 *  (b) 청크 개수 + 앞 3개 청크의 {index, kind, text앞30자, startOffset, endOffset} 출력
 * 모두 통과하면 "INVARIANT OK" 출력. 실패 시 비0 종료코드로 종료.
 */
import { buildChunks } from './index.ts'
import { DEFAULT_CHUNK_OPTIONS } from '../types.ts'

// 이 파일은 Node 전용 실행 스크립트다(@types/node 미설치 환경에서도 타입검사 통과하도록
// process 를 최소 선언). svelte-check 가 src 전체를 훑어도 에러가 나지 않게 한다.
declare const process: { exit(code: number): never }

interface Sample {
  name: string
  md: string
}

const samples: Sample[] = [
  {
    name: '종합(헤더·강조·코드블록·링크·표·리스트·인용)',
    md: `# 마크다운 라디오 소개

이것은 **굵게** 강조하고 *기울임*도 쓰는 첫 문단입니다. 자세한 내용은 [공식 문서](https://example.com/docs)를 참고하세요. 그리고 https://bare-url.example.com/long/path 같은 원문 URL도 있습니다.

## 코드 예시

아래는 코드 블록입니다.

\`\`\`js
const radio = new Radio();
radio.play();
\`\`\`

인라인 코드 \`useState\` 는 읽습니다. 소수점 3.14 와 약어 Dr. Kim 도 한 문장 안에 둡니다.

### 기능 목록

- 첫 번째 기능은 흘려듣기입니다.
- 두 번째 기능은 북마크입니다.
- 세 번째 기능은 정독 뷰입니다.

| 항목 | 설명 |
|------|------|
| 정제 | 마크다운을 평문으로 |
| 청크 | 문장 단위 분할 |

> 인용문도 마커를 떼고 본문만 읽습니다.

---

마지막 문단입니다. 이미지 ![대체텍스트](image.png) 는 기본으로 건너뜁니다.`,
  },
  {
    name: '긴 문장 강제분할(maxChars 초과)',
    md: `오늘은 날씨가 정말 좋았고 그래서 우리는 아침 일찍 공원에 나가서 산책을 했으며 점심에는 근처 식당에서 맛있는 음식을 먹었고 오후에는 도서관에 가서 책을 읽었으며 저녁에는 집으로 돌아와서 가족과 함께 영화를 보면서 즐거운 시간을 보냈는데 이렇게 긴 문장은 합성 지연과 크롬 침묵 버그를 피하기 위해 반드시 중간에서 강제로 분할되어야 합니다.`,
  },
  {
    name: '짧은 청크 병합 + 헤더 무음',
    md: `# 짧은 제목

네. 아니요. 그렇군요. 이것들은 너무 짧아서 병합되어야 하는 문장들입니다.

## 다음 코너

새 코너의 첫 문장입니다.`,
  },
  {
    // ⚠️ 실제 사용자 문서 회귀(B.1~B.4): 이모지(서로게이트) 헤더 + sql 코드블록 +
    //   [a.md](a.md) 자기참조 링크 + bare URL + 강조 마커. 예전엔 불변식 위반 다수로 throw 했다.
    name: '실사용 회귀(이모지·SQL코드블록·md링크·강조)',
    md: `# 🛠 Supabase 셋업 가이드

이 문서는 **빨간 경고 — 딱 하나만 조심!** 하면 됩니다. 🔔 자세한 건 [supabase-setup-guide.md](supabase-setup-guide.md) 를 보세요. 그리고 https://supabase.com/docs 도 참고. 🚀

## 🔑 환경 변수

📦 아래 SQL을 실행하세요.

\`\`\`sql
create policy "is_public read"
  on documents for select
  using ( is_public = true );

alter table users add column password text;
\`\`\`

👍 끝! 🎉 이제 동작합니다. 🙋 질문은 이슈로. 🧠 참고로 🔜 다음 단계는 🗺️ 로드맵 참고.`,
  },
  {
    // ⚠️ FN-03 회귀(꺾쇠 오토링크·백슬래시 이스케이프): auditor 실증 위반 2종.
    //   <https://...> 오토링크는 "링크"로 치환되는데 원문 slice 의 <,> 가 normalize 후 남아
    //   불일치했고, \* \_ 등 백슬래시 이스케이프는 (a) normalize 가 \ 를 안 지워서,
    //   (b) value.length(백슬래시 제거) 폭으로 끝 글자가 잘려서 이중으로 어긋났다.
    name: '오토링크 꺾쇠·백슬래시 이스케이프(FN-03 회귀)',
    md: `문의는 <https://example.com> 로 메일 주세요.

이것은 \\*강조아님\\* 이고 가격은 1\\.5배이며 \\#해시태그 아님 \\[대괄호\\] 도 그대로입니다.

자세한 건 <https://docs.example.org/guide> 와 \\_언더스코어\\_ 를 참고하세요.`,
  },
]

function preview(s: string, n = 30): string {
  const oneLine = s.replace(/\s+/g, ' ')
  return oneLine.length > n ? oneLine.slice(0, n) + '…' : oneLine
}

let allOk = true

for (const sample of samples) {
  console.log('\n══════════════════════════════════════════')
  console.log(`샘플: ${sample.name}`)
  console.log('──────────────────────────────────────────')
  try {
    const { blocks, chunks } = buildChunks(sample.md, { strict: true })
    const speech = chunks.filter((c) => c.kind === 'speech')
    const silence = chunks.filter((c) => c.kind === 'silence')
    console.log(
      `blocks=${blocks.length}, chunks=${chunks.length} (speech=${speech.length}, silence=${silence.length})`,
    )
    console.log('앞 3개 청크:')
    for (const c of chunks.slice(0, 3)) {
      console.log(
        `  #${c.index} [${c.kind}] off=[${c.startOffset},${c.endOffset}] ` +
          `${c.kind === 'silence' ? `silenceMs=${c.silenceMs}` : `text="${preview(c.text)}"`}`,
      )
    }
    // 추가 가시성: 각 speech 청크의 원문 slice 와 정제 text 를 한 줄로(불변식 직관 확인)
    console.log('불변식 샘플 점검(앞 2개 speech):')
    for (const c of speech.slice(0, 2)) {
      const sliced = sample.md.slice(c.startOffset, c.endOffset)
      console.log(`  slice="${preview(sliced, 40)}"`)
      console.log(`  text ="${preview(c.text, 40)}"`)
    }
    console.log('  ✓ assertChunkInvariant 통과')
  } catch (err) {
    allOk = false
    console.error('  ✗ 실패:')
    console.error(String(err instanceof Error ? err.message : err))
  }
}

// 옵션 변형도 한 번 검증: 코드블록 읽기 + 표 나열 + 이미지 alt
console.log('\n══════════════════════════════════════════')
console.log('샘플: 옵션 변형(코드읽기·표나열·alt읽기)')
console.log('──────────────────────────────────────────')
try {
  const md = samples[0].md
  const { chunks } = buildChunks(md, {
    refine: { skipCodeBlocks: false, tableMode: 'list', readImageAlt: true },
    chunk: DEFAULT_CHUNK_OPTIONS,
    strict: true,
  })
  console.log(`chunks=${chunks.length}`)
  console.log('  ✓ assertChunkInvariant 통과')
} catch (err) {
  allOk = false
  console.error('  ✗ 실패:')
  console.error(String(err instanceof Error ? err.message : err))
}

console.log('\n══════════════════════════════════════════')
if (allOk) {
  console.log('INVARIANT OK')
  process.exit(0)
} else {
  console.error('INVARIANT FAILED')
  process.exit(1)
}
