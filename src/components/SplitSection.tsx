import { useMemo, useState } from 'react'
import type { RefObject } from 'react'
import type { Annotation } from '../types'
import {
  SPLIT_LABELS,
  SPLIT_NAMES,
  buildSplitJsonl,
  parseSplitPercents,
  planSplit,
  splitJsonlFilename,
  type SplitName,
  type SplitPercentInput,
} from '../lib/split'

interface Props {
  title: string
  text: string
  annotations: Annotation[]
  /** 训练集划分导出分区的滚动定位 ref（顶栏按钮用） */
  sectionRef?: RefObject<HTMLElement | null>
}

/** 生成一个随机种子（与抽样复核一致，仅用于稳定分散，不要求密码学强度） */
function randomSeed(): string {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const buf = new Uint32Array(2)
    crypto.getRandomValues(buf)
    return `${Date.now().toString(36)}-${buf[0].toString(36)}${buf[1].toString(36)}`
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 浏览器端下载文本文件（JSONL） */
function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/x-ndjson;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function percentClass(n: number): string {
  if (n < 10) return 'split-pct-low'
  if (n < 20) return 'split-pct-mid'
  return 'split-pct-high'
}

/** 训练集划分导出侧栏分区：百分比 + 种子输入、划分统计与 JSONL 下载 */
export function SplitSection(props: Props) {
  const { title, text, annotations } = props
  const [seed, setSeed] = useState(() => randomSeed())
  const [raw, setRaw] = useState<SplitPercentInput>({
    train: '80',
    validation: '10',
    test: '10',
  })

  const boundCount = useMemo(
    () => annotations.filter((a) => a.status === 'bound').length,
    [annotations],
  )
  const pendingCount = annotations.length - boundCount

  const percentResult = useMemo(() => parseSplitPercents(raw), [raw])
  const seedReady = seed.trim().length > 0

  // 输入合法且种子非空、存在已绑定标注时实时给出划分计划（无需“生成”按钮）
  const plan = useMemo(() => {
    if (!percentResult.ok || !seedReady || boundCount === 0) return null
    return planSplit({ annotations, seed: seed.trim(), percents: percentResult.percents })
  }, [percentResult, seedReady, boundCount, annotations, seed])

  const setPercent = (s: SplitName, v: string) =>
    setRaw((r) => ({ ...r, [s]: v }))

  const download = (s: SplitName) => {
    if (!plan) return
    const jsonl = buildSplitJsonl(plan, annotations, { title, text }, s)
    if (!jsonl) return
    downloadText(splitJsonlFilename(title, s), jsonl)
  }

  const sum = percentResult.ok
    ? 100
    : percentResult.error === 'sum'
      ? percentResult.sum
      : null

  return (
    <section
      className="side-section"
      ref={(props.sectionRef as React.Ref<HTMLElement>) ?? undefined}
    >
      <h2 className="side-heading side-heading-split">训练集划分导出</h2>
      <p className="side-hint">
        仅使用<strong>已绑定</strong>标注：把区间有<strong>字符交集</strong>的标注归入同一连通组
        （交集可传递），<strong>整组不可拆分</strong>，不会落到不同数据集。组按
        <code>SHA-256(种子 + 组内标注 ID 排序后拼接)</code> 排序，再依次放入当前相对目标缺口
        最大的集合；同缺口按 train、validation、test 决胜。相同输入结果稳定。
      </p>

      {boundCount === 0 ? (
        <p className="side-hint">
          当前没有任何已绑定标注可划分。先在原文中完成标注绑定（待处理标注不会导出）。
        </p>
      ) : (
        <>
          <div className="split-form">
            <div className="split-percent-rows">
              {SPLIT_NAMES.map((s) => (
                <div className="split-percent-row" key={s}>
                  <span className="split-percent-label">{SPLIT_LABELS[s]}</span>
                  <input
                    id={`split-percent-${s}`}
                    className="rule-input split-percent-input"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={raw[s]}
                    onChange={(e) => setPercent(s, e.target.value)}
                  />
                  <span className="split-percent-sign">%</span>
                </div>
              ))}
            </div>
            <p
              className={`split-sum ${
                percentResult.ok ? 'split-sum-ok' : sum !== null ? 'split-sum-bad' : ''
              }`}
            >
              合计 <strong>{sum ?? '—'}</strong> / 100
            </p>

            <label className="form-label split-seed-label" htmlFor="split-seed">
              划分种子
            </label>
            <div className="split-seed-row">
              <input
                id="split-seed"
                className="rule-input split-seed-input"
                value={seed}
                placeholder="输入任意字符串作为种子"
                onChange={(e) => setSeed(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-small btn-ghost"
                title="随机生成一个种子"
                onClick={() => setSeed(randomSeed())}
              >
                随机
              </button>
            </div>
            <p className="side-hint split-form-hint">
              相同种子、百分比与标注集必然得到<strong>相同划分</strong>，与界面顺序无关。
            </p>

            {!percentResult.ok && percentResult.error === 'invalid' && (
              <p className="split-error">三项都必须是 0–100 的整数。</p>
            )}
            {!percentResult.ok && percentResult.error === 'sum' && (
              <p className="split-error">
                三项合计须为 100（当前为 {percentResult.sum ?? '—'}）。
              </p>
            )}
            {percentResult.ok && !seedReady && (
              <p className="split-error">请填写种子。</p>
            )}
          </div>

          {plan && (
            <>
              <div className="split-stats">
                {SPLIT_NAMES.map((s) => {
                  const stat = plan.stats[s]
                  const pct = (stat.ratio * 100).toFixed(1)
                  return (
                    <div className="split-stat" key={s}>
                      <div className="split-stat-head">
                        <span className="split-stat-name">{SPLIT_LABELS[s]}</span>
                        <span className={`split-stat-pct ${percentClass(stat.percent)}`}>
                          目标 {stat.percent}%
                        </span>
                      </div>
                      <div className="split-stat-nums">
                        <strong>{stat.groupCount}</strong> 组 ·{' '}
                        <strong>{stat.annotationCount}</strong> 条标注 · 实际{' '}
                        <strong>{pct}%</strong>
                      </div>
                      <button
                        type="button"
                        className="btn btn-small btn-primary split-download-btn"
                        disabled={stat.groupCount === 0}
                        onClick={() => download(s)}
                        title={
                          stat.groupCount === 0
                            ? '该集合没有连通组，无可下载内容'
                            : `下载 ${s} 的 JSONL（每行一个连通组）`
                        }
                      >
                        下载 {s}.jsonl
                      </button>
                    </div>
                  )
                })}
              </div>

              <p className="side-hint split-total">
                共 <strong>{plan.totalGroups}</strong> 个连通组 ·{' '}
                <strong>{plan.totalAnnotations}</strong> 条已绑定标注参与划分
                {plan.excludedPending > 0 && (
                  <>
                    ；<em className="split-excluded">{plan.excludedPending} 条待处理标注已排除、不导出</em>
                  </>
                )}
                。每个 JSONL 一行对应一个连通组，包含文档标题、原文、集合名以及组内标注的
                ID、区间、引文、标签与备注。
              </p>
            </>
          )}

          {!plan && pendingCount > 0 && (
            <p className="side-hint split-pending-hint">
              当前有 <em className="split-excluded">{pendingCount} 条待处理标注</em>
              ，不会参与划分、也不会出现在导出的 JSONL 中。
            </p>
          )}
        </>
      )}
    </section>
  )
}
