import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import './motionLab.css'
import { HolidayMotionLabScreen } from './HolidayMotionLabScreen'

type MotionView = 'stacked' | 'expanded'
type EnergyState = 'quiet' | 'glow' | 'bright' | 'settled'

type DemoCard = {
  id: string
  eyebrow: string
  title: string
  detail: string
  accent: string
  symbol: string
}

type CardPosition = {
  x: string
  y: string
  mobileY: string
  rotate: string
}

const DEMO_CARDS: DemoCard[] = [
  {
    id: 'morning',
    eyebrow: '晨间',
    title: '晨间事项',
    detail: '5:00-6:30 · 先照顾好自己',
    accent: 'rose',
    symbol: '☼',
  },
  {
    id: 'breakfast',
    eyebrow: '早',
    title: '早餐',
    detail: '谷物蔬菜碗 · 让上午慢一点',
    accent: 'apricot',
    symbol: '◒',
  },
  {
    id: 'supplement',
    eyebrow: '补剂',
    title: '午间补剂',
    detail: '午间营养 · 和午餐一起',
    accent: 'mint',
    symbol: '✦',
  },
  {
    id: 'exercise',
    eyebrow: '节奏',
    title: '健身',
    detail: '核心训练 · 20 分钟',
    accent: 'blue',
    symbol: '↗',
  },
  {
    id: 'custom',
    eyebrow: '旁线',
    title: '整理书桌',
    detail: '16:30 · 给晚上留一点空间',
    accent: 'lilac',
    symbol: '○',
  },
]

const CARD_POSITIONS: CardPosition[] = [
  { x: '25%', y: '22%', mobileY: '12%', rotate: '-3deg' },
  { x: '75%', y: '22%', mobileY: '31%', rotate: '2deg' },
  { x: '25%', y: '52%', mobileY: '50%', rotate: '1deg' },
  { x: '75%', y: '52%', mobileY: '69%', rotate: '-2deg' },
  { x: '50%', y: '80%', mobileY: '84%', rotate: '-1deg' },
]

const ENERGY_LABELS: Record<EnergyState, string> = {
  quiet: '安静燃烧',
  glow: '开始有能量',
  bright: '今天很明亮',
  settled: '今天安定下来',
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function stopButtonEvent(event: PointerEvent<HTMLButtonElement>) {
  event.stopPropagation()
}

function MollyFlame({ state }: { state: EnergyState }) {
  return (
    <div className={`motion-flame motion-flame-${state}`} aria-label={`Molly 状态：${ENERGY_LABELS[state]}`}>
      <div className="motion-flame-aura" />
      <svg viewBox="0 0 96 96" role="img" aria-hidden="true">
        <path
          className="motion-flame-outer"
          d="M48 8c5 16-11 20-3 31 4 6 12 7 12 18 0 11-8 20-19 20-13 0-22-10-22-23 0-13 8-20 18-28 7-6 10-11 14-18Z"
        />
        <path
          className="motion-flame-inner"
          d="M49 34c8 9 14 15 14 25 0 8-6 14-14 14-8 0-14-6-14-14 0-7 5-12 10-17 2-2 3-5 4-8Z"
        />
        <circle cx="42" cy="57" r="2.6" fill="#3f2826" />
        <circle cx="56" cy="57" r="2.6" fill="#3f2826" />
        <path d="M44 64c2 3 6 3 8 0" fill="none" stroke="#3f2826" strokeLinecap="round" strokeWidth="2.5" />
        <circle cx="35" cy="63" r="3" fill="#f39b8b" opacity=".72" />
        <circle cx="63" cy="63" r="3" fill="#f39b8b" opacity=".72" />
      </svg>
    </div>
  )
}

function MotionCard({
  card,
  cardIndex,
  stackIndex,
  view,
  focused,
  completed,
  saving,
  ready,
  dragOffset,
  onSelect,
  onComplete,
  onRestore,
}: {
  card: DemoCard
  cardIndex: number
  stackIndex: number
  view: MotionView
  focused: boolean
  completed: boolean
  saving: boolean
  ready: boolean
  dragOffset: number
  onSelect: () => void
  onComplete: () => void
  onRestore: () => void
}) {
  const position = CARD_POSITIONS[cardIndex]
  const cardStyle = {
    '--stack-index': stackIndex,
    '--stack-y': `${stackIndex * 15}px`,
    '--stack-rotate': `${stackIndex === 0 ? 0 : (stackIndex % 2 === 0 ? -1 : 1) * (stackIndex + 1) * 0.7}deg`,
    '--stack-scale': `${1 - stackIndex * 0.025}`,
    '--drag-x': stackIndex === 0 ? `${dragOffset}px` : '0px',
    '--expanded-x': position.x,
    '--expanded-y': position.y,
    '--expanded-y-mobile': position.mobileY,
    '--expanded-rotate': position.rotate,
    '--expanded-order': cardIndex,
  } as CSSProperties

  return (
    <article
      className={[
        'motion-card-shell',
        ready ? 'is-ready' : '',
        focused ? 'is-focused' : '',
        completed ? 'is-completed' : '',
        view === 'expanded' ? 'is-expanded' : 'is-stacked',
      ].filter(Boolean).join(' ')}
      style={cardStyle}
      data-card-id={card.id}
      data-tone={card.accent}
      data-stack-index={stackIndex}
      onClick={onSelect}
    >
      <div className="motion-card">
        <div className="motion-card-sheen" aria-hidden="true" />
        <div className="motion-card-head">
          <span className="motion-card-symbol" aria-hidden="true">{card.symbol}</span>
          <span className="motion-card-eyebrow">{card.eyebrow}</span>
          <span className="motion-card-number">0{cardIndex + 1}</span>
        </div>

        <div className="motion-card-copy">
          <h3>{card.title}</h3>
          <p>{card.detail}</p>
        </div>

        <div className="motion-card-foot">
          <span className={`motion-card-status${completed ? ' is-done' : ''}`}>
            {saving ? '保存中' : completed ? '已完成' : focused ? '当前焦点' : view === 'expanded' ? '稍后' : '待展开'}
          </span>
          {view === 'expanded' ? (
            <button
              className={`motion-card-action${completed ? ' is-restore' : ''}`}
              type="button"
              disabled={saving}
              onPointerDown={stopButtonEvent}
              onClick={(event) => {
                event.stopPropagation()
                if (completed) onRestore()
                else onComplete()
              }}
            >
              {saving ? '保存中' : completed ? '恢复' : '完成'}
            </button>
          ) : focused ? (
            <button
              className="motion-card-action"
              type="button"
              disabled={saving || completed}
              onPointerDown={stopButtonEvent}
              onClick={(event) => {
                event.stopPropagation()
                onComplete()
              }}
            >
              {saving ? '保存中' : completed ? '已完成' : '完成'}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function StackMotionLabScreen() {
  const [view, setView] = useState<MotionView>('stacked')
  const [focusId, setFocusId] = useState(DEMO_CARDS[0].id)
  const [completedIds, setCompletedIds] = useState<string[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('点击顶层卡片，查看它如何展开成一张桌面。')
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [ready, setReady] = useState(false)
  const [spotlight, setSpotlight] = useState({ x: 50, y: 50 })
  const gestureRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const didGestureRef = useRef(false)
  const noticeTimerRef = useRef<number | null>(null)
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    document.title = 'Motion Lab · 幸福小Molly'
    const frame = window.requestAnimationFrame(() => setReady(true))
    return () => {
      window.cancelAnimationFrame(frame)
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [])

  const focusedCard = DEMO_CARDS.find((card) => card.id === focusId) ?? DEMO_CARDS[0]
  const completedCount = completedIds.length
  const energyState: EnergyState = completedCount === 0
    ? 'quiet'
    : completedCount === DEMO_CARDS.length
      ? 'settled'
      : completedCount >= 3
        ? 'bright'
        : 'glow'

  const visibleCards = useMemo(() => {
    if (view === 'expanded') return DEMO_CARDS

    const completedSet = new Set(completedIds)
    const activeCards = DEMO_CARDS.filter((card) => !completedSet.has(card.id))
    const settledCards = DEMO_CARDS.filter((card) => completedSet.has(card.id))

    if (activeCards.length === 0) return settledCards

    const startIndex = Math.max(0, activeCards.findIndex((card) => card.id === focusId))
    const orderedActiveCards = activeCards.map(
      (_, offset) => activeCards[(startIndex + offset) % activeCards.length],
    )

    return [...orderedActiveCards, ...settledCards]
  }, [completedIds, focusId, view])

  function flashNotice(message: string) {
    setNotice(message)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 2300)
  }

  function selectCard(cardId: string) {
    setFocusId(cardId)
    if (view === 'stacked') {
      if (didGestureRef.current) {
        didGestureRef.current = false
        return
      }
      setView('expanded')
      flashNotice('桌面已展开 · 当前焦点保持在最上层')
      return
    }
    flashNotice(`${DEMO_CARDS.find((card) => card.id === cardId)?.title ?? '事项'} 已成为当前焦点`)
  }

  function moveFocus(step: number) {
    const currentIndex = DEMO_CARDS.findIndex((card) => card.id === focusId)
    const nextIndex = (currentIndex + step + DEMO_CARDS.length) % DEMO_CARDS.length
    const nextCard = DEMO_CARDS[nextIndex]
    setFocusId(nextCard.id)
    flashNotice(`${nextCard.title} 已置顶`)
  }

  function completeCard(cardId: string) {
    if (savingId || completedIds.includes(cardId)) return
    const card = DEMO_CARDS.find((item) => item.id === cardId)
    if (!card) return

    setSavingId(cardId)
    flashNotice('演示保存中 · 卡片暂不改变位置')
    saveTimerRef.current = window.setTimeout(() => {
      setCompletedIds((current) => [...current, cardId])
      setSavingId(null)
      const nextCard = visibleCards.find((item) => item.id !== cardId && !completedIds.includes(item.id))
      setFocusId(nextCard?.id ?? cardId)
      flashNotice(`${card.title} 已完成 · 保存成功后才移动`)
    }, 620)
  }

  function restoreCard(cardId: string) {
    setCompletedIds((current) => current.filter((id) => id !== cardId))
    setFocusId(cardId)
    flashNotice('已恢复为待完成状态')
  }

  function resetDemo() {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    setCompletedIds([])
    setSavingId(null)
    setFocusId(DEMO_CARDS[0].id)
    setDragOffset(0)
    setView('stacked')
    flashNotice('演示已重置')
  }

  function handleStagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (view !== 'stacked' || savingId) return
    if (event.target instanceof Element && event.target.closest('button')) return
    gestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    setIsDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleStagePointerMove(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    setSpotlight({
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    })

    const origin = gestureRef.current
    if (!origin || origin.pointerId !== event.pointerId) return
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    setDragOffset(Math.abs(dx) > Math.abs(dy) ? clamp(dx, -100, 150) : 0)
  }

  function handleStagePointerUp(event: PointerEvent<HTMLDivElement>) {
    const origin = gestureRef.current
    gestureRef.current = null
    setIsDragging(false)
    setDragOffset(0)
    if (!origin || origin.pointerId !== event.pointerId) return

    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    const horizontal = Math.abs(dx) > Math.abs(dy)
    const vertical = Math.abs(dy) > Math.abs(dx)

    if (horizontal && dx >= 76) {
      didGestureRef.current = true
      completeCard(focusedCard.id)
      return
    }
    if (vertical && Math.abs(dy) >= 56) {
      didGestureRef.current = true
      moveFocus(dy < 0 ? 1 : -1)
    }
  }

  function handleStageKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(-1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (view === 'stacked') setView('expanded')
      else completeCard(focusedCard.id)
    }
  }

  const stageStyle = {
    '--spot-x': `${spotlight.x}%`,
    '--spot-y': `${spotlight.y}%`,
  } as CSSProperties

  return (
    <main className={`motion-lab${view === 'expanded' ? ' is-expanded-mode' : ''}`}>
      <div className="motion-lab-shell">
        <header className="motion-lab-header">
          <div className="motion-lab-heading">
            <a className="motion-lab-back" href="/">← 返回正式页面</a>
            <p className="motion-lab-kicker">MOTION LAB / STACK PROTOTYPE</p>
            <h1>把今天叠成一组<br /><em>可以翻阅的卡片</em></h1>
            <p className="motion-lab-lede">
              这是独立的动画实验页。这里的完成、展开与滑动都只是演示，不读写正式计划。
            </p>
          </div>

          <div className="motion-lab-title-mark" aria-hidden="true">
            <span>ML</span>
            <i />
          </div>
        </header>

        <div className="motion-lab-layout">
          <section className="motion-workbench" aria-label="叠放卡片动画实验">
            <div className="motion-workbench-bar">
              <div>
                <span className="motion-bar-label">TODAY / STACK</span>
                <strong>{view === 'stacked' ? '叠放视图' : '桌面视图'}</strong>
              </div>
              <div className="motion-view-switch" role="group" aria-label="切换展示视图">
                <button
                  className={view === 'stacked' ? 'is-active' : ''}
                  type="button"
                  onClick={() => {
                    setView('stacked')
                    flashNotice('卡片重新叠放 · 当前焦点留在顶层')
                  }}
                >
                  叠放
                </button>
                <button
                  className={view === 'expanded' ? 'is-active' : ''}
                  type="button"
                  onClick={() => {
                    setView('expanded')
                    flashNotice('全部展开 · 卡片落到实体桌面')
                  }}
                >
                  展开
                </button>
              </div>
            </div>

            <div
              className={`motion-stage motion-stage-${view}${isDragging ? ' is-dragging' : ''}`}
              style={stageStyle}
              data-view={view}
              tabIndex={0}
              role="application"
              aria-label="卡片堆叠实验区，可用方向键浏览"
              onKeyDown={handleStageKeyDown}
              onPointerDown={handleStagePointerDown}
              onPointerMove={handleStagePointerMove}
              onPointerUp={handleStagePointerUp}
              onPointerCancel={handleStagePointerUp}
            >
              <div className="motion-stage-caption">
                <span>{view === 'stacked' ? 'ONE SPACE / FIVE MOMENTS' : 'DESKTOP SURFACE / ALL MOMENTS'}</span>
                <span>{completedCount}/{DEMO_CARDS.length} settled</span>
              </div>

              <div className="motion-card-field">
                {visibleCards.map((card, stackIndex) => {
                  const cardIndex = DEMO_CARDS.findIndex((item) => item.id === card.id)
                  return (
                    <MotionCard
                      key={card.id}
                      card={card}
                      cardIndex={cardIndex}
                      stackIndex={stackIndex}
                      view={view}
                      focused={card.id === focusId}
                      completed={completedIds.includes(card.id)}
                      saving={savingId === card.id}
                      ready={ready}
                      dragOffset={dragOffset}
                      onSelect={() => selectCard(card.id)}
                      onComplete={() => completeCard(card.id)}
                      onRestore={() => restoreCard(card.id)}
                    />
                  )
                })}
              </div>

              <div className="motion-stage-hint" aria-hidden="true">
                <span className="motion-hint-arrow">↕</span>
                <span>{view === 'stacked' ? '上下浏览 · 向右完成' : '按节奏向下浏览 · 每张都可完成'}</span>
              </div>
            </div>

            <div className="motion-workbench-footer">
              <p className="motion-notice" role="status">{notice || '准备开始'}</p>
              <div className="motion-footer-actions">
                <button className="motion-quiet-button" type="button" onClick={() => moveFocus(-1)} aria-label="上一张卡片">
                  ↑
                </button>
                <button className="motion-quiet-button" type="button" onClick={() => moveFocus(1)} aria-label="下一张卡片">
                  ↓
                </button>
                <button
                  className="motion-primary-button"
                  type="button"
                  disabled={Boolean(savingId) || completedIds.includes(focusedCard.id)}
                  onClick={() => completeCard(focusedCard.id)}
                >
                  <span>{savingId ? '演示保存中' : '完成'}</span>
                  <b>↗</b>
                </button>
              </div>
            </div>
          </section>

          <aside className="motion-inspector" aria-label="动画状态检查器">
            <div className="motion-inspector-heading">
              <span className="motion-bar-label">MOTION INSPECTOR</span>
              <span className="motion-live"><i /> LIVE PREVIEW</span>
            </div>

            <div className="motion-focus-readout">
              <span className="motion-readout-label">当前焦点</span>
              <strong>{focusedCard.title}</strong>
              <span>{focusedCard.detail}</span>
            </div>

            <div className="motion-flame-readout">
              <MollyFlame state={energyState} />
              <div>
                <span className="motion-readout-label">Molly / 今日能量</span>
                <strong>{ENERGY_LABELS[energyState]}</strong>
                <span>只由演示中已完成的卡片产生</span>
              </div>
            </div>

            <div className="motion-inspector-actions">
              <button type="button" onClick={() => setView('expanded')}>
                <span>全部展开</span>
                <b>↗</b>
              </button>
              <button type="button" onClick={() => setView('stacked')}>
                <span>收起叠放</span>
                <b>↓</b>
              </button>
              <button type="button" onClick={resetDemo}>
                <span>重置演示</span>
                <b>↺</b>
              </button>
            </div>

            <div className="motion-principles">
              <div>
                <span>01</span>
                <p>收起时只占一个桌面位置，焦点卡永远在最上层。</p>
              </div>
              <div>
                <span>02</span>
                <p>展开不是跳转页面，而是把同一组内容摊到实体桌面。</p>
              </div>
              <div>
                <span>03</span>
                <p>完成先经过保存反馈，成功后卡片才沉到堆叠底部。</p>
              </div>
            </div>
          </aside>
        </div>

        <footer className="motion-lab-footer">
          <span>幸福小Molly / UI 第三阶段动画实验</span>
          <span>本页不写入本地数据</span>
        </footer>
      </div>
    </main>
  )
}

export function MotionLabScreen() {
  const holidayScene = new URLSearchParams(window.location.search).get('scene') === 'holiday'
  return holidayScene ? <HolidayMotionLabScreen /> : <StackMotionLabScreen />
}
