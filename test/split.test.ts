import assert from 'node:assert'
import { createHash } from 'node:crypto'
import {
  buildOverlapGroups,
  buildSplitJsonl,
  parsePercent,
  parseSplitPercents,
  planSplit,
  splitGroupHash,
  splitJsonlFilename,
  SPLIT_NAMES,
} from '../src/lib/split'
import type { Annotation } from '../src/types'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

let seq = 0
function ann(
  id: string,
  start: number,
  end: number,
  opts: Partial<Annotation> = {},
): Annotation {
  seq += 1
  return {
    id,
    quote: `q-${id}`,
    start,
    end,
    note: '',
    tags: [],
    status: 'bound',
    createdAt: seq,
    updatedAt: seq,
    contextBefore: '',
    contextAfter: '',
    ...opts,
  }
}

/** 参考实现的组哈希：SHA-256(种子 + 排序后 ID 直接拼接) */
function refHash(seed: string, ids: string[]): string {
  return createHash('sha256').update(`${seed}${[...ids].sort().join('')}`, 'utf8').digest('hex')
}

/** 独立参考分配：按组哈希升序，n/percent 最小（交叉相乘）、同缺口按 train/validation/test */
function refAssign(
  groups: Array<{ annotationIds: string[]; size: number; hash: string }>,
  percents: { train: number; validation: number; test: number },
): string[] {
  const counts = { train: 0, validation: 0, test: 0 }
  const out: string[] = []
  for (const g of [...groups].sort(
    (x, y) =>
      (x.hash < y.hash ? -1 : x.hash > y.hash ? 1 : 0) ||
      (() => {
        const a = x.annotationIds
        const b = y.annotationIds
        const k = Math.min(a.length, b.length)
        for (let i = 0; i < k; i++) {
          if (a[i] < b[i]) return -1
          if (a[i] > b[i]) return 1
        }
        return a.length - b.length
      })(),
  )) {
    let best: string | null = null
    let bestN = 0
    let bestP = 1
    for (const s of SPLIT_NAMES) {
      const p = percents[s]
      if (p <= 0) continue
      const n = counts[s as keyof typeof counts]
      if (best === null || n * bestP < bestN * p) {
        best = s
        bestN = n
        bestP = p
      }
    }
    const t = best ?? 'train'
    counts[t as keyof typeof counts] += g.size
    out.push(t)
  }
  return out
}

// 1. 连通组：字符交集传递闭包
check('区间有字符交集的标注（含传递关系）归入同一连通组', () => {
  // [0,5) 交 [3,8)，[3,8) 交 [6,10)：三者同组；[20,25) 独立成组
  const groups = buildOverlapGroups([
    ann('a3', 6, 10),
    ann('a1', 0, 5),
    ann('a4', 20, 25),
    ann('a2', 3, 8),
  ])
  assert.strictEqual(groups.length, 2)
  const ids = groups.map((g) => g.join(',')).sort()
  assert.deepStrictEqual(ids, ['a1,a2,a3', 'a4'])
})

// 2. 半开区间端点相接不算交集
check('端点相接 [0,5) 与 [5,10) 不连通', () => {
  const groups = buildOverlapGroups([ann('a', 0, 5), ann('b', 5, 10)])
  assert.strictEqual(groups.length, 2)
})

// 3. 空区间与任何区间（含另一空区间）不连通
check('空区间标注各自成组', () => {
  const groups = buildOverlapGroups([
    ann('e1', 3, 3),
    ann('e2', 3, 3),
    ann('x', 0, 10),
  ])
  assert.strictEqual(groups.length, 3)
})

// 4. 待处理标注不参与分组
check('待处理标注被排除在连通组之外', () => {
  const groups = buildOverlapGroups([
    ann('b1', 0, 5),
    ann('p1', 2, 9, { status: 'pending' }),
    ann('b2', 6, 10),
  ])
  // b1 与 b2 无交集（[0,5) 与 [6,10)），pending 的 p1 不把它们连起来
  assert.strictEqual(groups.length, 2)
  assert.deepStrictEqual(groups.flat().sort(), ['b1', 'b2'])
})

// 5. 组内 ID 排序；结果与传入顺序无关
check('分组结果不受传入顺序影响、组内 ID 字典序排列', () => {
  const list = [ann('z', 0, 4), ann('a', 1, 5), ann('m', 30, 33)]
  const g1 = buildOverlapGroups(list)
  const g2 = buildOverlapGroups([...list].reverse())
  const norm = (gs: string[][]) => gs.map((g) => g.join(',')).sort()
  assert.deepStrictEqual(norm(g1), norm(g2))
  assert.deepStrictEqual(norm(g1), ['a,z', 'm'])
})

// 6. splitGroupHash = SHA-256(种子 + 排序后 ID 拼接)
check('splitGroupHash 即 SHA-256(种子 + 组内 ID 排序后拼接)', () => {
  assert.strictEqual(splitGroupHash('seed', ['b', 'a']), refHash('seed', ['b', 'a']))
  assert.strictEqual(splitGroupHash('seed', ['a', 'b']), refHash('seed', ['b', 'a']))
  assert.notStrictEqual(splitGroupHash('seed1', ['a']), splitGroupHash('seed2', ['a']))
  assert.notStrictEqual(
    splitGroupHash('seed', ['a', 'c']),
    splitGroupHash('seed', ['a', 'b']),
    '不同 ID 集合的摘要不同',
  )
  // 排序保证：组哈希与传入顺序无关
  assert.strictEqual(splitGroupHash('s', ['z', 'a', 'm']), splitGroupHash('s', ['a', 'm', 'z']))
})

// 7. parsePercent 边界
check('parsePercent 只接受 0–100 整数', () => {
  assert.strictEqual(parsePercent('0'), 0)
  assert.strictEqual(parsePercent(' 80 '), 80)
  assert.strictEqual(parsePercent('100'), 100)
  assert.strictEqual(parsePercent(''), null)
  assert.strictEqual(parsePercent('10.0'), null)
  assert.strictEqual(parsePercent('-1'), null)
  assert.strictEqual(parsePercent('101'), null)
  assert.strictEqual(parsePercent('abc'), null)
  assert.strictEqual(parsePercent('1e1'), null)
})

// 8. parseSplitPercents 合计 100 才合法
check('parseSplitPercents：三项整数且合计 100 才合法', () => {
  const ok = parseSplitPercents({ train: '80', validation: '10', test: '10' })
  assert.deepStrictEqual(
    ok,
    { ok: true, percents: { train: 80, validation: 10, test: 10 } },
  )
  const zero = parseSplitPercents({ train: '100', validation: '0', test: '0' })
  assert.deepStrictEqual(
    zero,
    { ok: true, percents: { train: 100, validation: 0, test: 0 } },
  )
  const badSum = parseSplitPercents({ train: '80', validation: '10', test: '5' })
  assert.deepStrictEqual(badSum, { ok: false, error: 'sum', sum: 95 })
  const invalid = parseSplitPercents({ train: '80', validation: 'x', test: '20' })
  assert.strictEqual(invalid.ok, false)
  if (!invalid.ok) assert.strictEqual(invalid.error, 'invalid')
})

// 9. 确定性：组顺序、分配结果与标注传入顺序无关
check('planSplit 对相同输入（含乱序）产出完全相同的计划', () => {
  const list = [
    ann('z1', 0, 4, { tags: ['T'] }),
    ann('a2', 2, 8),
    ann('m3', 10, 14),
    ann('b4', 12, 20),
    ann('q5', 40, 44),
  ]
  const p1 = planSplit({
    annotations: list,
    seed: 'stable',
    percents: { train: 80, validation: 10, test: 10 },
  })
  const p2 = planSplit({
    annotations: [...list].reverse(),
    seed: 'stable',
    percents: { train: 80, validation: 10, test: 10 },
  })
  assert.deepStrictEqual(
    p1.groups.map((g) => [g.annotationIds, g.split]),
    p2.groups.map((g) => [g.annotationIds, g.split]),
  )
  // 组按哈希升序排列
  const hashes = p1.groups.map((g) => g.hash)
  assert.deepStrictEqual(hashes, [...hashes].sort())
})

// 10. 前三个组：相对缺口相同 → train、validation、test 依次决胜
check('同缺口按 train、validation、test 决胜：前三组各入一个集合', () => {
  // 三条互不相交、等长（单标注）组，目标 80/10/10
  const plan = planSplit({
    annotations: [ann('g1', 0, 1), ann('g2', 10, 11), ann('g3', 20, 21)],
    seed: 's',
    percents: { train: 80, validation: 10, test: 10 },
  })
  const firstThree = plan.groups.slice(0, 3).map((g) => g.split)
  assert.deepStrictEqual(firstThree.sort(), ['test', 'train', 'validation'])
})

// 11. 前三组之后：1/80 < 1/10，第 4、5 组继续入 train（交叉相乘精确比较，与组 ID 无关）
check('后续组按 n/percent 相对缺口（标注数口径）精确比较，交叉相乘无浮点偏差', () => {
  // 5 个等规模（单标注）组：组身份按哈希排列，但名次决定分配，与 ID 无关
  const list = Array.from({ length: 5 }, (_, i) => ann(`g${i}`, i * 10, i * 10 + 1))
  const plan = planSplit({
    annotations: list,
    seed: 's',
    percents: { train: 80, validation: 10, test: 10 },
  })
  // 名次 0/1/2 初始缺口相同 → train、validation、test
  assert.deepStrictEqual(
    plan.groups.slice(0, 3).map((g) => g.split).sort(),
    ['test', 'train', 'validation'],
  )
  // 名次 3：train 1/80=0.0125 远小于 val/test 1/10=0.1 → train
  assert.strictEqual(plan.groups[3].split, 'train')
  // 名次 4：train 2/80=0.025 仍小于 0.1 → train（val/test 要等 train 达到 8/80 才被追平）
  assert.strictEqual(plan.groups[4].split, 'train')
  assert.deepStrictEqual(
    SPLIT_NAMES.map((s) => plan.stats[s].annotationCount),
    [3, 1, 1],
  )

  // 与独立参考实现逐组一致（组身份经哈希打乱后仍一致）
  const expected = refAssign(
    plan.groups.map((g) => ({ annotationIds: g.annotationIds, size: g.size, hash: g.hash })),
    { train: 80, validation: 10, test: 10 },
  )
  assert.deepStrictEqual(plan.groups.map((g) => g.split), expected)
})

// 12. 百分比为 0 的集合永不接收组
check('目标 0% 的集合不接收任何组', () => {
  const plan = planSplit({
    annotations: [ann('a', 0, 1), ann('b', 10, 11)],
    seed: 's',
    percents: { train: 100, validation: 0, test: 0 },
  })
  assert.ok(plan.groups.every((g) => g.split === 'train'))
  assert.strictEqual(plan.stats.validation.groupCount, 0)
  assert.strictEqual(plan.stats.test.groupCount, 0)
  assert.strictEqual(plan.stats.train.groupCount, 2)
})

// 13. 整组不可拆分：组的标注数作为一个整体计入
check('连通组整体计入一个集合，组内标注不拆分', () => {
  // 一条 3 标注的大连通组 + 若干单标注组，验证大连通组不会被拆开
  const list = [
    ann('big1', 0, 6),
    ann('big2', 2, 8),
    ann('big3', 4, 10),
    ann('solo1', 30, 31),
    ann('solo2', 40, 41),
    ann('solo3', 50, 51),
  ]
  const plan = planSplit({
    annotations: list,
    seed: 's',
    percents: { train: 50, validation: 25, test: 25 },
  })
  const big = plan.groups.find((g) => g.annotationIds.length === 3)!
  assert.strictEqual(big.size, 3)
  // 该组所有标注在同一集合
  const stat = plan.stats[big.split]
  assert.ok(stat.annotationCount >= 3)
  // 三集合标注数总和等于全部已绑定标注
  const total = SPLIT_NAMES.reduce((n, s) => n + plan.stats[s].annotationCount, 0)
  assert.strictEqual(total, 6)
  const totalGroups = SPLIT_NAMES.reduce((n, s) => n + plan.stats[s].groupCount, 0)
  assert.strictEqual(totalGroups, plan.totalGroups)
})

// 14. 与独立参考实现全量一致（多个种子 × 多种百分比）
check('分配结果与独立参考实现一致（穷举若干种子与百分比）', () => {
  // 构造若干规模不一的重叠连通组：组内区间 [pos+k, pos+k+3) 彼此交叠，组间间隔 ≥10
  const sizes = [1, 1, 2, 1, 3, 1, 1, 2, 1, 4, 1, 2]
  const overlapList: Annotation[] = []
  let pos = 0
  sizes.forEach((size, gi) => {
    for (let k = 0; k < size; k++) {
      overlapList.push(ann(`grp${gi}_ann${k}`, pos + k, pos + k + 3))
    }
    pos += size + 10
  })

  for (const seed of ['a', '种子X', '']) {
    for (const percents of [
      { train: 80, validation: 10, test: 10 },
      { train: 50, validation: 25, test: 25 },
      { train: 34, validation: 33, test: 33 },
      { train: 100, validation: 0, test: 0 },
      { train: 0, validation: 0, test: 100 },
    ]) {
      const plan = planSplit({ annotations: overlapList, seed, percents })
      const expected = refAssign(
        plan.groups.map((g) => ({
          annotationIds: g.annotationIds,
          size: g.size,
          hash: g.hash,
        })),
        percents,
      )
      assert.deepStrictEqual(
        plan.groups.map((g) => g.split),
        expected,
        `seed=${JSON.stringify(seed)} percents=${JSON.stringify(percents)}`,
      )
    }
  }
})

// 15. 统计：组数、标注数、实际占比
check('stats 正确报告各集合组数、标注数与实际占比', () => {
  const plan = planSplit({
    annotations: [ann('a', 0, 1), ann('b', 10, 11), ann('c', 20, 21), ann('d', 30, 31)],
    seed: 's',
    percents: { train: 100, validation: 0, test: 0 },
  })
  assert.strictEqual(plan.stats.train.annotationCount, 4)
  assert.strictEqual(plan.stats.train.groupCount, 4)
  assert.strictEqual(plan.stats.train.ratio, 1)
  assert.strictEqual(plan.stats.validation.ratio, 0)
  assert.strictEqual(plan.totalGroups, 4)
  assert.strictEqual(plan.totalAnnotations, 4)
  assert.strictEqual(plan.excludedPending, 0)
})

// 16. 排除数：待处理标注不导出并计入 excludedPending
check('待处理标注计入 excludedPending 且不参与 totalAnnotations', () => {
  const plan = planSplit({
    annotations: [
      ann('b1', 0, 2),
      ann('p1', 5, 9, { status: 'pending' }),
      ann('p2', 50, 60, { status: 'pending' }),
    ],
    seed: 's',
    percents: { train: 80, validation: 10, test: 10 },
  })
  assert.strictEqual(plan.totalAnnotations, 1)
  assert.strictEqual(plan.excludedPending, 2)
  assert.strictEqual(plan.totalGroups, 1)
})

// 17. 空文档：无组、无标注，统计全 0
check('没有已绑定标注时计划为空、不抛错', () => {
  const plan = planSplit({
    annotations: [ann('p', 0, 5, { status: 'pending' })],
    seed: 's',
    percents: { train: 80, validation: 10, test: 10 },
  })
  assert.deepStrictEqual(plan.groups, [])
  assert.strictEqual(plan.totalGroups, 0)
  assert.strictEqual(plan.totalAnnotations, 0)
  for (const s of SPLIT_NAMES) {
    assert.strictEqual(plan.stats[s].groupCount, 0)
    assert.strictEqual(plan.stats[s].annotationCount, 0)
    assert.strictEqual(plan.stats[s].ratio, 0)
  }
})

// 18. JSONL：每组一行，含标题/原文/集合名及组内标注字段
check('buildSplitJsonl 每行一个组、字段完整且只含目标集合', () => {
  const a1 = ann('a1', 0, 3, { quote: '甲乙丙', note: '备注1', tags: ['X', 'Y'] })
  const a2 = ann('a2', 1, 4, { quote: '乙丙丁', note: '', tags: ['Z'] })
  const a3 = ann('a3', 20, 22, { quote: '戊己', note: '备注3', tags: [] })
  const doc = { title: '标题 T', text: '甲乙丙丁……戊己……' }
  const plan = planSplit({
    annotations: [a1, a2, a3],
    seed: 's',
    percents: { train: 34, validation: 33, test: 33 },
  })
  for (const s of SPLIT_NAMES) {
    const jsonl = buildSplitJsonl(plan, [a1, a2, a3], doc, s)
    const lines = jsonl.trim() ? jsonl.trim().split('\n') : []
    const expectedGroups = plan.groups.filter((g) => g.split === s)
    assert.strictEqual(lines.length, expectedGroups.length, `${s} 行数应等于该集合组数`)
    for (const line of lines) {
      const row = JSON.parse(line)
      assert.strictEqual(row.title, '标题 T')
      assert.strictEqual(row.text, doc.text)
      assert.strictEqual(row.split, s)
      assert.ok(typeof row.groupHash === 'string' && row.groupHash.length === 64)
      assert.ok(Array.isArray(row.annotations))
      // 组内标注 ID 字典序
      const annIds = row.annotations.map((x: { id: string }) => x.id)
      assert.deepStrictEqual(annIds, [...annIds].sort())
      for (const x of row.annotations) {
        assert.ok('start' in x && 'end' in x && 'quote' in x && 'tags' in x && 'note' in x && 'id' in x)
        assert.ok(!('status' in x), '行内标注不含绑定状态（只导已绑定）')
      }
    }
  }
  // 全部三个文件的行合计等于组数，且每个组只出现在自己的集合文件中
  const allLines = SPLIT_NAMES.flatMap((s) =>
    buildSplitJsonl(plan, [a1, a2, a3], doc, s).trim().split('\n').filter(Boolean),
  )
  assert.strictEqual(allLines.length, plan.groups.length)
})

// 19. 连通组的多行 JSONL：a1/a2 同组必须出现在同一行、同一集合
check('字符交集组在 JSONL 中同属一行且不跨集合', () => {
  const a1 = ann('a1', 0, 3, { quote: '甲乙丙' })
  const a2 = ann('a2', 1, 4, { quote: '乙丙丁' })
  const doc = { title: 'T', text: '甲乙丙丁' }
  const plan = planSplit({
    annotations: [a1, a2],
    seed: 's',
    percents: { train: 80, validation: 10, test: 10 },
  })
  assert.strictEqual(plan.groups.length, 1)
  const s = plan.groups[0].split
  const same = buildSplitJsonl(plan, [a1, a2], doc, s)
  assert.strictEqual(same.trim().split('\n').length, 1)
  const row = JSON.parse(same)
  assert.deepStrictEqual(
    row.annotations.map((x: { id: string }) => x.id).sort(),
    ['a1', 'a2'],
  )
  // 另外两个集合文件为空
  for (const other of SPLIT_NAMES) {
    if (other === s) continue
    assert.strictEqual(buildSplitJsonl(plan, [a1, a2], doc, other), '')
  }
})

// 20. 文件名稳定且安全
check('splitJsonlFilename 含集合名、安全标题与日期', () => {
  const name = splitJsonlFilename('a/b:c*?', 'train')
  assert.ok(name.startsWith('训练集划分_train_'))
  assert.ok(name.endsWith('.jsonl'))
  assert.ok(!/[\\/:*?"<>|]/.test(name))
})

console.log(`\nsplit：${passed} 项断言全部通过`)
