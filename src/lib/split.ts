// 训练集划分导出：区间交叠连通组 + 确定性哈希排序 + 相对目标缺口贪心分配
//
// 仅使用【已绑定】标注：两条标注的半开区间 [start,end) 只要存在至少 1 个字符交集
// （start < other.end && other.start < end）就连通；连通关系按并查集取传递闭包，
// 因此 A 交 B、B 交 C 时三者归入同一组。任何一个连通组都是不可拆分的整体，
// 不会被分到不同数据集。待处理标注不参与划分（由调用方报告排除数）。
//
// 组排序：对每个组计算 SHA-256(种子 + 组内标注 ID 按字典序排序后拼接)，按摘要升序。
// 分配：各组依次放入「当前相对目标缺口最大」的集合——
//   相对缺口以「已放入标注数 / 目标百分比」衡量（值越小缺口越大），
//   用整数交叉相乘精确比较（n1/p1 与 n2/p2 比较 n1*p2 与 n2*p1，规避浮点误差），
//   缺口相同按 train、validation、test 的固定顺序决胜。
// 因此相同输入（种子、百分比、标注集）必然得到完全相同的划分结果。

import type { Annotation } from '../types'
import { sha256Hex } from './sampling'

export const SPLIT_NAMES = ['train', 'validation', 'test'] as const
export type SplitName = (typeof SPLIT_NAMES)[number]

export const SPLIT_LABELS: Record<SplitName, string> = {
  train: 'train 训练集',
  validation: 'validation 验证集',
  test: 'test 测试集',
}

// ---------- 连通组 ----------

/**
 * 把已绑定标注按区间字符交集归入连通组，返回各组的标注 ID。
 * 组内 ID 按字典序排列；结果整体顺序不由本函数保证（调用方按哈希排序）。
 * 空区间（start === end）与任何区间（含另一空区间）都不相交，各自成组。
 * 待处理标注不参与。
 */
export function buildOverlapGroups(annotations: Annotation[]): string[][] {
  const bound = annotations.filter((a) => a.status === 'bound')

  // 并查集
  const parent = bound.map((_, i) => i)
  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root]
    while (parent[i] !== i) {
      const next = parent[i]
      parent[i] = root
      i = next
    }
    return root
  }
  const union = (i: number, j: number) => {
    const ri = find(i)
    const rj = find(j)
    if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj)
  }

  // O(n²) 两两判交，与冲突检测保持同一规模口径（单文档标注量级可接受）
  for (let i = 0; i < bound.length; i++) {
    for (let j = i + 1; j < bound.length; j++) {
      const x = bound[i]
      const y = bound[j]
      // 空区间（start === end）不含任何字符，与谁都不相交，各自成组
      if (x.end <= x.start || y.end <= y.start) continue
      // 半开区间至少 1 个字符交集；端点相接（x.end === y.start）不算
      if (x.start < y.end && y.start < x.end) union(i, j)
    }
  }

  const byRoot = new Map<number, string[]>()
  bound.forEach((a, i) => {
    const root = find(i)
    const list = byRoot.get(root)
    if (list) list.push(a.id)
    else byRoot.set(root, [a.id])
  })
  return [...byRoot.values()].map((ids) => [...ids].sort())
}

// ---------- 组哈希与排序 ----------

/** 组排序哈希：SHA-256(种子 + 组内标注 ID 排序后直接拼接) */
export function splitGroupHash(seed: string, annotationIds: string[]): string {
  const sorted = [...annotationIds].sort()
  return sha256Hex(`${seed}${sorted.join('')}`)
}

/** 标注 ID 列表的字典序比较（逐 ID 比较，再比长度）：哈希极端相同时的稳定决胜 */
function compareIdLists(x: string[], y: string[]): number {
  const k = Math.min(x.length, y.length)
  for (let i = 0; i < k; i++) {
    if (x[i] < y[i]) return -1
    if (x[i] > y[i]) return 1
  }
  return x.length - y.length
}

// ---------- 百分比校验 ----------

export type SplitPercents = Record<SplitName, number>
export type SplitPercentInput = Record<SplitName, string>

export type SplitPercentResult =
  | { ok: true; percents: SplitPercents }
  | { ok: false; error: 'invalid' | 'sum'; sum: number | null }

/** 解析单个百分比：仅接受 0–100 的整数（空串视为非法） */
export function parsePercent(raw: string): number | null {
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  if (!Number.isSafeInteger(n) || n < 0 || n > 100) return null
  return n
}

/** 校验三个百分比输入：必须都是 0–100 的整数且合计为 100（允许某项为 0） */
export function parseSplitPercents(raw: SplitPercentInput): SplitPercentResult {
  const values = SPLIT_NAMES.map((s) => parsePercent(raw[s]))
  if (values.some((v) => v === null)) {
    return { ok: false, error: 'invalid', sum: null }
  }
  const percents = values as number[]
  const sum = percents.reduce((n, v) => n + v, 0)
  if (sum !== 100) return { ok: false, error: 'sum', sum }
  const out = { } as SplitPercents
  SPLIT_NAMES.forEach((s, i) => {
    out[s] = percents[i]
  })
  return { ok: true, percents: out }
}

// ---------- 划分计划 ----------

export interface SplitGroup {
  /** 组内标注 ID，按字典序排列 */
  annotationIds: string[]
  /** 组内标注数 */
  size: number
  /** SHA-256(种子 + 排序后 ID 拼接) 十六进制摘要 */
  hash: string
  /** 该组最终落入的数据集 */
  split: SplitName
}

export interface SplitStat {
  split: SplitName
  /** 目标百分比 */
  percent: number
  groupCount: number
  annotationCount: number
  /** 标注数实际占比（0..1）；无已绑定标注时为 0 */
  ratio: number
}

export interface SplitPlan {
  /** 组按哈希升序排列（同哈希按组内 ID 列表字典序），split 为分配结果 */
  groups: SplitGroup[]
  stats: Record<SplitName, SplitStat>
  /** 连通组总数 */
  totalGroups: number
  /** 参与划分的已绑定标注总数 */
  totalAnnotations: number
  /** 被排除的待处理标注数 */
  excludedPending: number
}

/**
 * 依据种子、百分比与当前标注集生成确定性划分计划。
 * 纯函数：不修改传入数据；相同输入（含乱序标注）必得相同结果。
 */
export function planSplit(params: {
  annotations: Annotation[]
  seed: string
  percents: SplitPercents
}): SplitPlan {
  const { annotations, seed, percents } = params
  const totalAnnotations = annotations.filter((a) => a.status === 'bound').length
  const excludedPending = annotations.length - totalAnnotations

  const groups: SplitGroup[] = buildOverlapGroups(annotations)
    .map((ids) => ({
      annotationIds: ids,
      size: ids.length,
      hash: splitGroupHash(seed, ids),
      split: 'train' as SplitName, // 占位，下面统一分配
    }))
    .sort(
      (x, y) =>
        (x.hash < y.hash ? -1 : x.hash > y.hash ? 1 : 0) ||
        compareIdLists(x.annotationIds, y.annotationIds),
    )

  // 各集合已放入的标注数
  const counts: SplitPercents = { train: 0, validation: 0, test: 0 }
  for (const g of groups) {
    // 相对目标缺口最大 ⇔ n/percent 最小（percent>0 的集合才可入选）。
    // 交叉相乘精确比较：n1/p1 < n2/p2 ⇔ n1*p2 < n2*p1；
    // 同缺口保持 SPLIT_NAMES 的 train、validation、test 遍历顺序，首个即胜。
    let best: SplitName | null = null
    let bestN = 0
    let bestP = 1
    for (const s of SPLIT_NAMES) {
      const p = percents[s]
      if (p <= 0) continue
      const n = counts[s]
      if (best === null || n * bestP < bestN * p) {
        best = s
        bestN = n
        bestP = p
      }
    }
    // 合计 100 且存在待分组时，至少一个 percent > 0，best 必非空
    const target = best ?? 'train'
    g.split = target
    counts[target] += g.size
  }

  const groupCounts = { train: 0, validation: 0, test: 0 }
  for (const g of groups) groupCounts[g.split] += 1

  const stats = { } as Record<SplitName, SplitStat>
  for (const s of SPLIT_NAMES) {
    const annotationCount = counts[s]
    stats[s] = {
      split: s,
      percent: percents[s],
      groupCount: groupCounts[s],
      annotationCount,
      ratio: totalAnnotations > 0 ? annotationCount / totalAnnotations : 0,
    }
  }

  return {
    groups,
    stats,
    totalGroups: groups.length,
    totalAnnotations,
    excludedPending,
  }
}

// ---------- JSONL 导出 ----------

export interface SplitJsonlAnnotation {
  id: string
  /** 半开区间 [start,end)（相对文档原文的字符偏移） */
  start: number
  end: number
  quote: string
  tags: string[]
  note: string
}

export interface SplitJsonlRow {
  /** 文档标题（每行重复，便于脱离文档直接使用） */
  title: string
  /** 文档原文 */
  text: string
  /** 集合名：train | validation | test */
  split: SplitName
  /** 组哈希：SHA-256(种子 + 排序后 ID 拼接)，可回溯划分顺序与组身份 */
  groupHash: string
  /** 组内标注，按标注 ID 字典序排列；整组只出现在同一集合中 */
  annotations: SplitJsonlAnnotation[]
}

/**
 * 生成某个集合的 JSONL 文本：每个连通组一行，行内为一个合法 JSON 对象，
 * 包含文档标题、原文、集合名以及组内每条标注的 ID、区间、引文、标签与备注。
 * 组按计划中的哈希顺序输出。
 */
export function buildSplitJsonl(
  plan: SplitPlan,
  annotations: Annotation[],
  doc: { title: string; text: string },
  split: SplitName,
): string {
  const byId = new Map(annotations.map((a) => [a.id, a]))
  const lines: string[] = []
  for (const g of plan.groups) {
    if (g.split !== split) continue
    const rows: SplitJsonlAnnotation[] = []
    for (const id of g.annotationIds) {
      const a = byId.get(id)
      if (!a || a.status !== 'bound') continue
      rows.push({
        id: a.id,
        start: a.start,
        end: a.end,
        quote: a.quote,
        tags: [...a.tags],
        note: a.note,
      })
    }
    const row: SplitJsonlRow = {
      title: doc.title,
      text: doc.text,
      split,
      groupHash: g.hash,
      annotations: rows,
    }
    lines.push(JSON.stringify(row))
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

/** 某集合 JSONL 的下载文件名 */
export function splitJsonlFilename(title: string, split: SplitName): string {
  const safeTitle = (title || '未命名文档').replace(/[\\/:*?"<>|\s]+/g, '_')
  const date = new Date().toISOString().slice(0, 10)
  return `训练集划分_${split}_${safeTitle}_${date}.jsonl`
}
