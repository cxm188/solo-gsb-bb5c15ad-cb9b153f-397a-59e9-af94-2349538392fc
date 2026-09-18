import assert from 'node:assert'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
const { window } = dom
;(globalThis as unknown as { window: typeof window }).window = window
;(globalThis as unknown as { document: Document }).document = window.document
;(globalThis as unknown as { navigator: Navigator }).navigator = window.navigator
;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
  window.HTMLElement
;(globalThis as unknown as { Element: typeof Element }).Element = window.Element
;(globalThis as unknown as { Node: typeof Node }).Node = window.Node
;(globalThis as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter =
  window.NodeFilter
;(globalThis as unknown as { getSelection: typeof window.getSelection }).getSelection =
  window.getSelection.bind(window)
;(globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame =
  ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown) as typeof requestAnimationFrame
;(globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame =
  ((id: number) => clearTimeout(id) as unknown) as typeof cancelAnimationFrame
;(globalThis as unknown as { localStorage: Storage }).localStorage = window.localStorage

// jsdom 不实现 scrollIntoView；覆盖审计 / 定位点击会调用它
if (typeof window.Element.prototype.scrollIntoView !== 'function') {
  window.Element.prototype.scrollIntoView = function scrollIntoView() {}
}

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { default: App } = await import('../src/App')

const container = document.getElementById('root')!
const root = createRoot(container)

await new Promise<void>((resolve) => {
  root.render(
    React.createElement(React.StrictMode, null, React.createElement(App)),
  )
  setTimeout(resolve, 100)
})

const html = container.innerHTML
assert.ok(html.includes('原文锚点标注台'), '顶栏标题应渲染')
assert.ok(html.includes('粘贴'), '空文档应显示粘贴入口')
console.log('  ✓ 空文档首次渲染成功（编辑模式）')

// 模拟已保存文档 + 一条 pending 标注的渲染路径
const saved = {
  title: '测试文档',
  text: '这是一段用于渲染冒烟测试的原文，包含【重点片段】和普通文字。'.repeat(3),
  updatedAt: Date.now(),
  annotations: [
    {
      id: 'a_bound',
      quote: '重点片段',
      start: 0,
      end: 4,
      note: '备注一',
      tags: ['重点', '测试'],
      status: 'bound',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextBefore: '',
      contextAfter: '】和普通文字。',
    },
    {
      id: 'a_pending',
      quote: '已删除的引文XYZ',
      start: 100,
      end: 110,
      note: '',
      tags: [],
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextBefore: '前文',
      contextAfter: '后文',
      pendingReason: '原文中已找不到该引文，需要手动重新选择',
    },
  ],
}
// start/end 对齐到真实位置，避免高亮错位
saved.annotations[0].start = saved.text.indexOf('重点片段') - 1
saved.annotations[0].end = saved.annotations[0].start + 6

localStorage.setItem('anchor-annotation-console:v1', JSON.stringify(saved))
// 重新挂载，让 App 从 localStorage 读取初始状态
root.unmount()
const container2 = document.createElement('div')
container2.id = 'root2'
document.body.appendChild(container2)
const root2 = createRoot(container2)

await new Promise<void>((resolve) => {
  root2.render(
    React.createElement(React.StrictMode, null, React.createElement(App)),
  )
  setTimeout(resolve, 100)
})

const html2 = container2.innerHTML
assert.ok(html2.includes('测试文档'), '应显示文档标题')
assert.ok(html2.includes('待处理'), '应渲染待处理分区')
assert.ok(html2.includes('重新选择片段'), 'pending 标注应有重绑按钮')
assert.ok(html2.includes('备注一'), '应渲染备注')
assert.ok(html2.includes('#重点'), '应渲染标签')
console.log('  ✓ 含 bound/pending 标注的文档渲染成功')

// 第三个场景：互斥规则 + 一对冲突标注 + 一条已忽略冲突
const conflictText = '甲乙丙丁戊己庚辛壬癸'.repeat(6)
const pos1 = conflictText.indexOf('丁戊')
const pos2 = conflictText.indexOf('戊己') // 与上一区间在「戊」上交叠
const savedConflicts = {
  title: '冲突文档',
  text: conflictText,
  updatedAt: Date.now(),
  annotations: [
    {
      id: 'c_pos',
      quote: conflictText.slice(pos1, pos1 + 2),
      start: pos1,
      end: pos1 + 2,
      note: '',
      tags: ['正面'],
      status: 'bound',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextBefore: '',
      contextAfter: '',
    },
    {
      id: 'c_neg',
      quote: conflictText.slice(pos2, pos2 + 2),
      start: pos2,
      end: pos2 + 2,
      note: '',
      tags: ['反面'],
      status: 'bound',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextBefore: '',
      contextAfter: '',
    },
    {
      id: 'c_ig1',
      quote: conflictText.slice(0, 3),
      start: 0,
      end: 3,
      note: '',
      tags: ['褒义'],
      status: 'bound',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextBefore: '',
      contextAfter: '',
    },
    {
      id: 'c_ig2',
      quote: conflictText.slice(1, 4),
      start: 1,
      end: 4,
      note: '',
      tags: ['贬义'],
      status: 'bound',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextBefore: '',
      contextAfter: '',
    },
  ],
  conflictRules: [
    { id: 'rule_pn', tagA: '正面', tagB: '反面', createdAt: Date.now() },
    { id: 'rule_bd', tagA: '褒义', tagB: '贬义', createdAt: Date.now() },
  ],
  ignoredConflicts: [
    { annotationIds: ['c_ig1', 'c_ig2'], ruleIds: ['rule_bd'], createdAt: Date.now() },
  ],
}

localStorage.setItem('anchor-annotation-console:v1', JSON.stringify(savedConflicts))
root2.unmount()
const container3 = document.createElement('div')
container3.id = 'root3'
document.body.appendChild(container3)
const root3 = createRoot(container3)

await new Promise<void>((resolve) => {
  root3.render(
    React.createElement(React.StrictMode, null, React.createElement(App)),
  )
  setTimeout(resolve, 100)
})

const html3 = container3.innerHTML
assert.ok(html3.includes('冲突审阅'), '应渲染冲突审阅分区')
assert.ok(html3.includes('正面 ⇄ 反面'), '应列出冲突命中的规则')
assert.ok(html3.includes('交叠原文'), '应展示交叠原文')
assert.ok(html3.includes('忽略此冲突'), '应提供忽略操作')
assert.ok(html3.includes('已忽略（1）'), '已忽略冲突折叠区应计数')
assert.ok(html3.includes('hl-conflict'), '未忽略冲突的交叠段应有冲突高亮类')
assert.ok(html3.includes('冲突审阅'), '顶栏应出现冲突审阅入口')
console.log('  ✓ 冲突审阅面板（含忽略折叠与交叠高亮）渲染成功')

// 标签重命名：打开弹层 → 预览 → 取消不改数据 → 再次确认后落地并写入 localStorage
{
  const renameText = '甲乙丙丁戊己庚辛壬癸'
  const renameDoc = {
    title: '重命名文档',
    text: renameText.repeat(4),
    updatedAt: Date.now(),
    annotations: [
      {
        id: 'rn_a',
        quote: '甲乙',
        start: 0,
        end: 2,
        note: '',
        tags: ['正面', '重点'],
        status: 'bound',
        createdAt: 100,
        updatedAt: 100,
        contextBefore: '',
        contextAfter: '',
      },
      {
        id: 'rn_b',
        quote: '乙丙',
        start: 1,
        end: 3,
        note: '',
        tags: ['反面'],
        status: 'bound',
        createdAt: 100,
        updatedAt: 100,
        contextBefore: '',
        contextAfter: '',
      },
    ],
    conflictRules: [
      { id: 'rn_r1', tagA: '正面', tagB: '反面', createdAt: 200 },
      { id: 'rn_r2', tagA: '正面', tagB: '其他', createdAt: 300 },
    ],
    ignoredConflicts: [
      { annotationIds: ['rn_a', 'rn_b'], ruleIds: ['rn_r1'], createdAt: 400 },
    ],
  }
  localStorage.setItem('anchor-annotation-console:v1', JSON.stringify(renameDoc))
  root3.unmount()
  const c = document.createElement('div')
  c.id = 'rootrn'
  document.body.appendChild(c)
  const r = createRoot(c)

  await new Promise<void>((resolve) => {
    r.render(React.createElement(React.StrictMode, null, React.createElement(App)))
    setTimeout(resolve, 100)
  })

  const clickButton = (text: string) => {
    const btn = [...c.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement | undefined
    assert.ok(btn, `应存在按钮「${text}」`)
    btn!.click()
    return btn!
  }

  clickButton('标签重命名')
  await new Promise<void>((resolve) => setTimeout(resolve, 50))

  // 选择源标签 + 填写目标标签
  const select = c.querySelector('.rename-fields select') as HTMLSelectElement
  assert.ok(select, '应渲染源标签下拉框')
  select.value = '正面'
  select.dispatchEvent(new window.Event('change', { bubbles: true }))
  const input = c.querySelector('.rename-fields input') as HTMLInputElement
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!
  setValue.call(input, '褒奖')
  input.dispatchEvent(new window.Event('input', { bubbles: true }))

  await new Promise<void>((resolve) => setTimeout(resolve, 50))
  const previewHtml = c.innerHTML
  assert.ok(previewHtml.includes('受影响标注'), '应展示受影响标注')
  assert.ok(previewHtml.includes('褒奖 ⇄ 反面'), '预览应列出替换后的规则')

  // 取消：数据不变
  clickButton('取消')
  const afterCancel = JSON.parse(localStorage.getItem('anchor-annotation-console:v1')!)
  assert.deepStrictEqual(afterCancel.annotations[0].tags, ['正面', '重点'])
  assert.strictEqual(afterCancel.conflictRules[0].tagA, '正面')
  console.log('  ✓ 取消预览不改动任何数据')

  // 重新打开并确认
  clickButton('标签重命名')
  const select2 = c.querySelector('select') as HTMLSelectElement
  select2.value = '正面'
  select2.dispatchEvent(new window.Event('change', { bubbles: true }))
  const input2 = c.querySelector('.rename-fields input') as HTMLInputElement
  setValue.call(input2, '褒奖')
  input2.dispatchEvent(new window.Event('input', { bubbles: true }))
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
  clickButton('确认重命名')
  await new Promise<void>((resolve) => setTimeout(resolve, 50))

  const afterApply = JSON.parse(localStorage.getItem('anchor-annotation-console:v1')!)
  assert.deepStrictEqual(afterApply.annotations[0].tags, ['褒奖', '重点'])
  assert.deepStrictEqual(
    afterApply.conflictRules.map((x: { tagA: string; tagB: string }) => [x.tagA, x.tagB]),
    [
      ['褒奖', '反面'],
      ['褒奖', '其他'],
    ],
  )
  // 忽略记录沿用规则 ID 且仍生效
  assert.deepStrictEqual(afterApply.ignoredConflicts[0].ruleIds, ['rn_r1'])
  assert.ok(!c.querySelector('.tag-rename-editor'), '确认后弹层关闭')
  assert.ok(c.innerHTML.includes('#褒奖'), '侧栏应显示新标签')
  console.log('  ✓ 确认重命名后标注/规则原子替换并持久化')

  r.unmount()
  c.remove()
}

// 标签覆盖审计：选择标签后实时显示缺口/重叠，点击定位，配置持久化
{
  // 0..19 共 20 字；a=[0,8) X，b=[5,12) X（与 a 重叠 [5,8)），[12,20) 为缺口
  const covText = '零一二三四五六七八九十甲乙丙丁戊己庚辛壬癸'
  const covDoc = {
    title: '覆盖文档',
    text: covText,
    updatedAt: Date.now(),
    annotations: [
      {
        id: 'cov_a',
        quote: covText.slice(0, 8),
        start: 0,
        end: 8,
        note: '',
        tags: ['X'],
        status: 'bound',
        createdAt: 100,
        updatedAt: 100,
        contextBefore: '',
        contextAfter: '',
      },
      {
        id: 'cov_b',
        quote: covText.slice(5, 12),
        start: 5,
        end: 12,
        note: '',
        tags: ['X'],
        status: 'bound',
        createdAt: 100,
        updatedAt: 100,
        contextBefore: '',
        contextAfter: '',
      },
      {
        id: 'cov_p',
        quote: '不存在的引文ZZZ',
        start: 0,
        end: 5,
        note: '',
        tags: ['X'],
        status: 'pending',
        createdAt: 100,
        updatedAt: 100,
        contextBefore: '',
        contextAfter: '',
        pendingReason: '原文中已找不到该引文，需要手动重新选择',
      },
    ],
  }
  localStorage.setItem('anchor-annotation-console:v1', JSON.stringify(covDoc))
  root3.unmount()
  const cc = document.createElement('div')
  cc.id = 'rootcov'
  document.body.appendChild(cc)
  const cr = createRoot(cc)

  await new Promise<void>((resolve) => {
    cr.render(React.createElement(React.StrictMode, null, React.createElement(App)))
    setTimeout(resolve, 100)
  })

  const html0 = cc.innerHTML
  assert.ok(html0.includes('标签覆盖审计'), '应渲染覆盖审计分区')
  // 未选择标签时无结果
  assert.ok(!html0.includes('cov-item'), '未选择标签时不应列出问题')

  // 点击标签 chip 选择 #X
  const chip = [...cc.querySelectorAll('.cov-tag')].find(
    (b) => b.textContent?.trim() === '#X',
  ) as HTMLButtonElement
  assert.ok(chip, '应出现标签选择按钮 #X')
  chip.click()
  await new Promise<void>((resolve) => setTimeout(resolve, 50))

  const html1 = cc.innerHTML
  assert.ok(html1.includes('缺口'), '应显示缺口结果')
  assert.ok(html1.includes('重叠'), '应显示重叠结果')
  assert.ok(html1.includes('2 条标注叠加'), '重叠卡片应列出叠加标注数')
  assert.ok(html1.includes('cov-gap'), '原文缺口段应有 cov-gap 着色')
  assert.ok(html1.includes('cov-overlap'), '原文重叠段应有 cov-overlap 着色')
  // 顶栏出现覆盖审计入口与计数（缺口 1 + 重叠 1 = 2）
  assert.ok(html1.includes('覆盖审计'), '顶栏应出现覆盖审计入口')
  // 配置已写入 localStorage
  const saved1 = JSON.parse(localStorage.getItem('anchor-annotation-console:v1')!)
  assert.deepStrictEqual(saved1.coverageTags, ['X'])

  // 点击重叠卡片的主体 → 区间高亮
  const overlapMain = cc.querySelector('.cov-item-overlap .cov-main') as HTMLButtonElement
  assert.ok(overlapMain, '应存在重叠结果卡片')
  overlapMain.click()
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
  assert.ok(cc.innerHTML.includes('cov-active'), '点击结果后应高亮对应区间')

  // 取消选择标签 → 结果清空、持久化同步
  chip.click()
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
  assert.ok(!cc.innerHTML.includes('cov-item'), '取消全部标签后问题清空')
  const saved2 = JSON.parse(localStorage.getItem('anchor-annotation-console:v1')!)
  assert.deepStrictEqual(saved2.coverageTags, [])
  console.log('  ✓ 标签覆盖审计：标签选择、缺口/重叠列表、原文着色、点击高亮与持久化')

  cr.unmount()
  cc.remove()
}

// 标签重命名后覆盖审计实时重算：旧标签选择自动跟随，结果仍正确
{
  const rnText = '零一二三四五六七八九十'
  const rnDoc = {
    title: '覆盖重命名',
    text: rnText,
    updatedAt: Date.now(),
    annotations: [
      {
        id: 'rnc_a',
        quote: rnText.slice(0, 5),
        start: 0,
        end: 5,
        note: '',
        tags: ['旧标签'],
        status: 'bound',
        createdAt: 1,
        updatedAt: 1,
        contextBefore: '',
        contextAfter: '',
      },
    ],
    coverageTags: ['旧标签'],
  }
  localStorage.setItem('anchor-annotation-console:v1', JSON.stringify(rnDoc))
  const c2 = document.createElement('div')
  c2.id = 'rootcovrn'
  document.body.appendChild(c2)
  const r2 = createRoot(c2)

  await new Promise<void>((resolve) => {
    r2.render(React.createElement(React.StrictMode, null, React.createElement(App)))
    setTimeout(resolve, 100)
  })

  // 选集中含「旧标签」，区间 [0,5) 覆盖、[5,10) 缺口
  assert.ok(c2.innerHTML.includes('缺口'), '重命名前应有缺口（后半段未覆盖）')

  const clickButton = (text: string) => {
    const btn = [...c2.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement | undefined
    assert.ok(btn, `应存在按钮「${text}」`)
    btn.click()
  }
  clickButton('标签重命名')
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
  const select = c2.querySelector('.rename-fields select') as HTMLSelectElement
  select.value = '旧标签'
  select.dispatchEvent(new window.Event('change', { bubbles: true }))
  const input = c2.querySelector('.rename-fields input') as HTMLInputElement
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!
  setValue.call(input, '新标签')
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
  clickButton('确认重命名')
  await new Promise<void>((resolve) => setTimeout(resolve, 50))

  const after = JSON.parse(localStorage.getItem('anchor-annotation-console:v1')!)
  assert.deepStrictEqual(after.coverageTags, ['新标签'], '覆盖标签集应跟随重命名')
  assert.deepStrictEqual(after.annotations[0].tags, ['新标签'])
  // 选择集跟随 → 缺口仍存在（覆盖区间不变）
  assert.ok(c2.innerHTML.includes('缺口'), '重命名后审计实时重算，缺口仍在')
  assert.ok(c2.innerHTML.includes('#新标签'), '标签选择器应显示新标签')
  console.log('  ✓ 标签重命名后覆盖审计选择集跟随并实时重算')

  r2.unmount()
  c2.remove()
}

// 快照对比：基线保存 → 删除/修改差异 → 已审签名 → 重建基线清空已审
{
  // App 中删除标注 / 重建基线走 confirm；jsdom 未实现，打桩为总是确认
  ;(globalThis as unknown as { confirm: () => boolean }).confirm = () => true
  window.confirm = () => true

  const snapText = '零一二三四五六七八九十'
  const snapDoc = {
    title: '快照文档',
    text: snapText,
    updatedAt: Date.now(),
    annotations: [
      {
        id: 'sn_a',
        quote: '零一',
        start: 0,
        end: 2,
        note: '备注A',
        tags: ['甲'],
        status: 'bound',
        createdAt: 1,
        updatedAt: 1,
        contextBefore: '',
        contextAfter: '',
      },
      {
        id: 'sn_b',
        quote: '三四',
        start: 3,
        end: 5,
        note: '',
        tags: [],
        status: 'bound',
        createdAt: 1,
        updatedAt: 1,
        contextBefore: '',
        contextAfter: '',
      },
    ],
  }
  localStorage.setItem('anchor-annotation-console:v1', JSON.stringify(snapDoc))
  const c = document.createElement('div')
  c.id = 'rootsnap'
  document.body.appendChild(c)
  const r = createRoot(c)

  await new Promise<void>((resolve) => {
    r.render(React.createElement(React.StrictMode, null, React.createElement(App)))
    setTimeout(resolve, 100)
  })

  const clickButton = (text: string) => {
    const btn = [...c.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement | undefined
    assert.ok(btn, `应存在按钮「${text}」`)
    btn!.click()
    return btn!
  }
  const saved = () => JSON.parse(localStorage.getItem('anchor-annotation-console:v1')!)
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 50))
  const doRename = async (source: string, target: string) => {
    clickButton('标签重命名')
    await wait()
    const select = c.querySelector('.rename-fields select') as HTMLSelectElement
    select.value = source
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
    const input = c.querySelector('.rename-fields input') as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!
    setValue.call(input, target)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await wait()
    clickButton('确认重命名')
    await wait()
  }

  assert.ok(c.innerHTML.includes('快照对比'), '应渲染快照对比分区')
  assert.ok(c.innerHTML.includes('保存当前为基线'), '无基线时应显示保存入口')

  // 1. 保存基线 → 无差异，基线持久化
  clickButton('保存当前为基线')
  await wait()
  assert.ok(c.innerHTML.includes('当前标注与基线一致'), '刚保存基线后应无差异')
  assert.strictEqual(saved().baseline.annotations.length, 2, '基线应含 2 条标注快照')
  assert.deepStrictEqual(saved().reviewedDiffs, [])

  // 2. 删除 sn_b → 删除差异展示基线引文；类型筛选可用
  const snbItem = [...c.querySelectorAll('.ann-item')].find((el) =>
    el.textContent?.includes('三四'),
  ) as HTMLElement
  assert.ok(snbItem, '应找到 sn_b 的标注卡片')
  const delBtn = [...snbItem.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === '删除',
  ) as HTMLButtonElement
  delBtn.click()
  await wait()
  const removedCard = c.querySelector('.snap-item.snap-removed')
  assert.ok(removedCard, '应出现删除差异卡片')
  assert.ok(
    removedCard!.querySelector('.snap-quote')?.textContent?.includes('三四'),
    '删除项应展示基线引文',
  )
  assert.ok(!removedCard!.textContent?.includes('定位'), '删除项不可定位')
  // 筛选：新增类型下没有差异
  const filterAdded = [...c.querySelectorAll('.snap-filter')].find((b) =>
    b.textContent?.startsWith('新增'),
  ) as HTMLButtonElement
  filterAdded.click()
  await wait()
  assert.ok(c.innerHTML.includes('该类型下没有差异项'), '新增筛选下应无差异项')
  const filterAll = [...c.querySelectorAll('.snap-filter')].find((b) =>
    b.textContent?.startsWith('全部'),
  ) as HTMLButtonElement
  filterAll.click()
  await wait()

  // 3. 标记已审 → 以「标注 ID + 签名」持久化
  clickButton('标记已审')
  await wait()
  assert.strictEqual(saved().reviewedDiffs.length, 1, '已审记录应持久化')
  assert.strictEqual(saved().reviewedDiffs[0].annotationId, 'sn_b')
  assert.ok(saved().reviewedDiffs[0].signature.length > 0)
  assert.ok(c.innerHTML.includes('取消已审'), '已审后应可取消')

  // 4. 重建基线 → 差异清空、已审记录清空
  clickButton('重建基线')
  await wait()
  assert.ok(c.innerHTML.includes('当前标注与基线一致'), '重建基线后应无差异')
  assert.strictEqual(saved().baseline.annotations.length, 1, '基线应重建为当前 1 条标注')
  assert.deepStrictEqual(saved().reviewedDiffs, [], '重建基线应清空已审记录')

  // 5. 标签重命名 甲→乙 → 修改差异逐字段列出标签前后值
  await doRename('甲', '乙')
  const modCard = c.querySelector('.snap-item.snap-modified')
  assert.ok(modCard, '应出现修改差异卡片')
  assert.ok(modCard!.textContent?.includes('标签'), '修改项应列出标签字段')
  assert.ok(modCard!.textContent?.includes('#甲'), '修改项应列出基线标签')
  assert.ok(modCard!.textContent?.includes('#乙'), '修改项应列出当前标签')
  assert.ok(c.innerHTML.includes('条快照差异待审'), '页脚应显示待审差异数')

  // 6. 标记已审 → 持久化；内容再次变化（乙→丙）→ 重新出现为未审
  clickButton('标记已审')
  await wait()
  assert.strictEqual(saved().reviewedDiffs.length, 1)
  await doRename('乙', '丙')
  assert.deepStrictEqual(saved().reviewedDiffs, [], '签名失效的已审记录应被清理')
  assert.ok(
    c.querySelector('.snap-item.snap-modified')?.textContent?.includes('标记已审'),
    '内容再次变化后应重新出现为未审',
  )

  // 7. 恢复成基线（丙→甲）→ 差异移除
  await doRename('丙', '甲')
  assert.ok(c.innerHTML.includes('当前标注与基线一致'), '恢复成基线后差异应移除')
  assert.deepStrictEqual(saved().reviewedDiffs, [])

  r.unmount()
  c.remove()
  console.log('  ✓ 快照对比：基线、删除/修改差异、已审签名、重建清空与持久化')
}

// 抽样复核：配置（标签配额 + 种子）→ 稳定队列 → 通过/退回结论与内容变化失效
{
  const spText = '零一二三四五六七八九'
  const mk = (id: string, start: number, end: number, tags: string[]) => ({
    id,
    quote: spText.slice(start, end),
    start,
    end,
    note: '',
    tags,
    status: 'bound',
    createdAt: 1,
    updatedAt: 1,
    contextBefore: '',
    contextAfter: '',
  })
  const spDoc = {
    title: '抽样文档',
    text: spText,
    updatedAt: Date.now(),
    annotations: [
      mk('sp_a', 0, 1, ['X']),
      mk('sp_b', 1, 2, ['X', 'Y']),
      mk('sp_c', 2, 3, ['X']),
      mk('sp_d', 3, 4, ['Y']),
      mk('sp_e', 4, 5, ['Y']),
    ],
  }
  localStorage.setItem('anchor-annotation-console:v1', JSON.stringify(spDoc))
  const cs = document.createElement('div')
  cs.id = 'rootsp'
  document.body.appendChild(cs)
  const sr = createRoot(cs)

  await new Promise<void>((resolve) => {
    sr.render(React.createElement(React.StrictMode, null, React.createElement(App)))
    setTimeout(resolve, 100)
  })

  const clickButton = (text: string) => {
    const btn = [...cs.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLButtonElement | undefined
    assert.ok(btn, `应存在按钮「${text}」`)
    btn!.click()
    return btn!
  }
  const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
    const proto =
      el instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 50))
  const saved = () => JSON.parse(localStorage.getItem('anchor-annotation-console:v1')!)

  assert.ok(cs.innerHTML.includes('抽样复核'), '应渲染抽样复核分区')
  assert.ok(cs.querySelector('#sample-seed'), '应渲染种子输入框')

  // 顶栏在未配置时不显示计数
  const topbarBefore = cs.innerHTML
  assert.ok(topbarBefore.includes('抽样复核'), '顶栏应出现抽样复核入口')

  // 填写种子
  setNativeValue(cs.querySelector('#sample-seed') as HTMLInputElement, '固定种子')
  // 两个标签的配额输入（按标签名字典序：X、Y）
  const countInputs = [...cs.querySelectorAll('.sample-count-input')] as HTMLInputElement[]
  assert.strictEqual(countInputs.length, 2, '应为 X、Y 两个标签渲染配额输入')
  setNativeValue(countInputs[0], '2') // X
  setNativeValue(countInputs[1], '2') // Y
  await wait()
  clickButton('生成抽样队列')
  await wait()

  let persisted = saved()
  assert.ok(persisted.sampleConfig, '配置应持久化')
  assert.strictEqual(persisted.sampleConfig.seed, '固定种子')
  assert.deepStrictEqual(
    persisted.sampleConfig.targets,
    [
      { tag: 'X', count: 2 },
      { tag: 'Y', count: 2 },
    ],
  )

  // 队列：sp_b 同时命中 X/Y，贪心首轮必入选；共抽 3 条（b 同时计入两个标签）
  const cards = [...cs.querySelectorAll('.sample-item')]
  assert.strictEqual(cards.length, 3, 'X=2、Y=2 且有共享标注时应抽中 3 条')
  assert.ok(cards[0]!.textContent?.includes(spDoc.annotations[1].quote), '首条应为覆盖最多标签的 sp_b')
  // 标签配额统计：目标 / 实际 / 缺口
  assert.ok(cs.innerHTML.includes('目标'), '应展示各标签目标数')
  assert.ok(cs.innerHTML.includes('实际'), '应展示各标签实际数')
  assert.strictEqual(cs.querySelectorAll('.sample-gap-hint').length, 0, '两标签均满足时不应出现缺口提示')
  assert.ok(cs.querySelectorAll('.sample-stat-ok').length >= 2, '两个标签均应显示满额')

  // 确定性：重新挂载后队列完全一致
  sr.unmount()
  const cs2 = document.createElement('div')
  cs2.id = 'rootsp2'
  document.body.appendChild(cs2)
  const sr2 = createRoot(cs2)
  await new Promise<void>((resolve) => {
    sr2.render(React.createElement(React.StrictMode, null, React.createElement(App)))
    setTimeout(resolve, 100)
  })
  const order1 = cards.map((c) => c.querySelector('.sample-quote')?.textContent)
  const order2 = [...cs2.querySelectorAll('.sample-item .sample-quote')].map((c) => c.textContent)
  assert.deepStrictEqual(order2, order1, '同配置重新挂载后队列必须完全相同')

  // 给首条（sp_b）填写备注并标记通过；第二条标记退回
  const cards2 = () => [...cs2.querySelectorAll('.sample-item')]
  const note0 = cards2()[0]!.querySelector('.sample-note') as HTMLTextAreaElement
  setNativeValue(note0, '复核无误')
  ;([...cards2()[0]!.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === '通过',
  ) as HTMLButtonElement).click()
  await wait()
  ;([...cards2()[1]!.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === '退回',
  ) as HTMLButtonElement).click()
  await wait()

  persisted = saved()
  assert.strictEqual(persisted.sampleReviews.length, 2, '两条结论应持久化')
  const byId = Object.fromEntries(persisted.sampleReviews.map((r: { annotationId: string }) => [r.annotationId, r]))
  assert.strictEqual(byId.sp_b.verdict, 'pass')
  assert.strictEqual(byId.sp_b.note, '复核无误')
  assert.strictEqual(byId[Object.keys(byId).find((k) => k !== 'sp_b')!].verdict, 'return')
  assert.ok(cs2.innerHTML.includes('待复核'), '仍有 1 条待复核（页脚或标题计数）')

  // 已复核项可取消
  ;([...cards2()[0]!.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === '通过',
  ) as HTMLButtonElement).click()
  await wait()
  assert.strictEqual(saved().sampleReviews.length, 1, '再次点击通过应取消该结论')

  // 重新标记通过，然后模拟内容变化（直接改 localStorage 中该标注的备注 → 签名失效）
  ;([...cards2()[0]!.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === '通过',
  ) as HTMLButtonElement).click()
  await wait()
  assert.strictEqual(saved().sampleReviews.length, 2)

  {
    const d = saved()
    const b = d.annotations.find((a: { id: string }) => a.id === 'sp_b')
    b.note = '标注内容被修改'
    d.updatedAt = Date.now()
    localStorage.setItem('anchor-annotation-console:v1', JSON.stringify(d))
  }
  sr2.unmount()
  const cs3 = document.createElement('div')
  cs3.id = 'rootsp3'
  document.body.appendChild(cs3)
  const sr3 = createRoot(cs3)
  await new Promise<void>((resolve) => {
    sr3.render(React.createElement(React.StrictMode, null, React.createElement(App)))
    setTimeout(resolve, 100)
  })
  const afterChange = saved()
  assert.ok(!afterChange.sampleReviews.some((r: { annotationId: string }) => r.annotationId === 'sp_b'),
    '标注内容变化后其结论应自动失效')
  assert.ok(afterChange.sampleReviews.some((r: { annotationId: string }) => r.annotationId !== 'sp_b'),
    '其他标注的结论应保留')
  // 失效项回到待复核（仍在队列中）
  assert.ok(cs3.innerHTML.includes('待复核'), '内容变化后抽中项回到待复核')
  console.log('  ✓ 抽样复核：配置持久化、稳定队列、通过/退回结论与内容变化自动失效')

  // 导入 / 导出包含配置与结论
  const exported = JSON.parse(localStorage.getItem('anchor-annotation-console:v1')!)
  assert.ok(exported.sampleConfig && Array.isArray(exported.sampleConfig.targets), '导出数据应含抽样配置')
  assert.ok(Array.isArray(exported.sampleReviews), '导出数据应含复核结论')

  sr3.unmount()
  cs.remove()
  cs2.remove()
  cs3.remove()
}

// 旧版数据（无 conflictRules / ignoredConflicts 字段）应无损加载
const legacy = {
  title: '旧文档',
  text: '一二三四五六',
  updatedAt: Date.now(),
  annotations: [],
}
localStorage.setItem('anchor-annotation-console:v1', JSON.stringify(legacy))
root3.unmount()
const container4 = document.createElement('div')
container4.id = 'root4'
document.body.appendChild(container4)
const root4 = createRoot(container4)

await new Promise<void>((resolve) => {
  root4.render(
    React.createElement(React.StrictMode, null, React.createElement(App)),
  )
  setTimeout(resolve, 100)
})

const html4 = container4.innerHTML
assert.ok(html4.includes('旧文档'), '旧版数据应正常加载标题')
assert.ok(html4.includes('冲突审阅'), '旧版数据应补出冲突审阅分区')
assert.ok(html4.includes('尚未配置互斥标签对'), '旧版数据应显示未配置规则提示')
// 保存回 localStorage 时应自动补齐新字段且不破坏原有数据
const reparsed = JSON.parse(localStorage.getItem('anchor-annotation-console:v1')!)
assert.ok(Array.isArray(reparsed.conflictRules) && reparsed.conflictRules.length === 0)
assert.ok(Array.isArray(reparsed.ignoredConflicts) && reparsed.ignoredConflicts.length === 0)
assert.ok(Array.isArray(reparsed.coverageTags) && reparsed.coverageTags.length === 0)
assert.strictEqual(reparsed.baseline, null)
assert.ok(Array.isArray(reparsed.reviewedDiffs) && reparsed.reviewedDiffs.length === 0)
assert.strictEqual(reparsed.sampleConfig, null)
assert.ok(Array.isArray(reparsed.sampleReviews) && reparsed.sampleReviews.length === 0)
assert.strictEqual(reparsed.text, '一二三四五六')
console.log('  ✓ 旧数据无损兼容并自动补齐冲突字段')

root4.unmount()
container4.remove()
container3.remove()
console.log('\n全部渲染冒烟测试通过')
