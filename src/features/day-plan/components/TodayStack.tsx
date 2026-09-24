import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { TodayRouteNode, TodayRoute } from './todayRouteModel'
import './todayStack.css'

type StackView = 'stacked' | 'expanded'

function stopButtonEvent(event: PointerEvent<HTMLButtonElement>) {
  event.stopPropagation()
}

function nodeLabel(node: TodayRouteNode): string {
  if (node.kind === 'exercise') return '健身'
  if (node.kind === 'supplement') return '补剂'
  if (node.kind === 'custom-task') return '自定义'
  if (node.kind === 'prep') return '准备'
  return node.kind === 'morning' ? '晨间' : node.title
}

function nodeSymbol(node: TodayRouteNode): string {
  if (node.kind === 'exercise') return '↗'
  if (node.kind === 'supplement') return '✦'
  if (node.kind === 'custom-task') return '○'
  if (node.kind === 'prep') return '□'
  if (node.kind === 'morning') return '☼'
  if (node.kind === 'meal') return '◒'
  return '·'
}

function nodeTone(node: TodayRouteNode): string {
  if (node.state === 'unprepared') return 'muted'
  if (node.kind === 'meal') return 'apricot'
  if (node.kind === 'supplement') return 'mint'
  if (node.kind === 'exercise') return 'blue'
  if (node.kind === 'custom-task') return 'lilac'
  if (node.kind === 'prep') return 'sand'
  return 'rose'
}

function nodeActionLabel(node: TodayRouteNode): string {
  if (node.completed) return '撤销'
  return '完成'
}

function legacyRowClass(node: TodayRouteNode): string {
  if (node.kind === 'prep') return 'prep-row'
  if (node.kind === 'custom-task') return 'execution-row task-row'
  return 'execution-row'
}

function legacyCompletionLabel(node: TodayRouteNode): string {
  if (node.kind === 'prep') return node.title
  if (node.kind === 'exercise') return '健身已完成'
  if (node.kind === 'supplement') return `${node.title.split(' · ').slice(1).join(' · ')}已完成`
  return `${node.title}已完成`
}

function StackCard({
  node,
  index,
  stackIndex,
  view,
  focused,
  saving,
  writable,
  onSelect,
  onToggle,
  onArrange,
  onEditTask,
  onDeleteTask,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
}: {
  node: TodayRouteNode
  index: number
  stackIndex: number
  view: StackView
  focused: boolean
  saving: boolean
  writable: boolean
  onSelect: () => void
  onToggle: () => void
  onArrange: () => void
  onEditTask: () => void
  onDeleteTask: () => void
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void
  onPointerUp?: (event: PointerEvent<HTMLElement>) => void
  onPointerCancel?: () => void
}) {
  const canToggle = writable && Boolean(node.completionTarget)
  const cardStyle = {
    '--today-stack-index': stackIndex,
    '--today-route-index': index,
    '--today-expanded-top': `${138 + index * 118}px`,
    '--today-expanded-top-mobile': `${118 + index * 128}px`,
  } as CSSProperties
  const canArrange = writable && Boolean(node.editorTarget) && !node.completionTarget
  const canEdit = view === 'expanded' && writable && Boolean(node.editorTarget) &&
    Boolean(node.completionTarget) && node.kind !== 'custom-task'

  if (view === 'stacked' && !focused) {
    return (
      <article
        className={`today-stack-card-shell is-stacked is-${node.state}${node.completed ? ' is-completed' : ''}`}
        style={cardStyle}
        aria-hidden="true"
      >
        <div className={`today-stack-card today-stack-card-${nodeTone(node)}`}>
          <div className="today-stack-card-sheen" aria-hidden="true" />
        </div>
      </article>
    )
  }

  return (
    <article
      className={[
        'today-stack-card-shell',
        `is-${view}`,
        `is-${node.state}`,
        focused ? 'is-focused' : '',
        focused ? 'today-focus' : '',
        node.completed ? 'is-completed' : '',
      ].filter(Boolean).join(' ')}
      style={cardStyle}
      data-node-id={node.id}
      data-node-state={node.state}
      data-focus-id={focused ? node.id : undefined}
      onClick={onSelect}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className={`today-stack-card today-stack-card-${nodeTone(node)}`}>
        <div className="today-stack-card-sheen" aria-hidden="true" />
        <div className="today-stack-card-head">
          <span className="today-stack-card-symbol" aria-hidden="true">{nodeSymbol(node)}</span>
          <span className="today-stack-card-eyebrow">{nodeLabel(node)}</span>
          <span className="today-stack-card-number">{String(index + 1).padStart(2, '0')}</span>
        </div>

        <div className="today-stack-card-copy">
          <strong className={`today-stack-card-title${focused ? ' today-focus-item' : ''}`}>{node.title}</strong>
          {focused ? <h2 className="today-stack-legacy-focus-heading">先把这一项安排好</h2> : null}
          {node.detail ? <p>{node.detail}</p> : null}
        </div>

        <div className="today-stack-card-foot">
          {view === 'expanded' && node.kind === 'custom-task' && writable ? (
            <div className="today-stack-task-actions">
              <button
                className="today-stack-text-action mini"
                type="button"
                disabled={saving}
                onPointerDown={stopButtonEvent}
                onClick={(event) => {
                  event.stopPropagation()
                  onEditTask()
                }}
              >
                编辑
              </button>
              <button
                className="today-stack-text-action is-danger mini"
                type="button"
                disabled={saving}
                onPointerDown={stopButtonEvent}
                onClick={(event) => {
                  event.stopPropagation()
                  onDeleteTask()
                }}
              >
                删除
              </button>
            </div>
          ) : null}

          {canEdit ? (
            <button
              className="today-stack-text-action mini"
              type="button"
              disabled={saving}
              onPointerDown={stopButtonEvent}
              onClick={(event) => {
                event.stopPropagation()
                onArrange()
              }}
            >
              编辑
            </button>
          ) : null}

          {canArrange ? (
            <button
              className={`today-stack-arrange${focused ? ' today-focus-action' : ''}`}
              type="button"
              disabled={saving}
              onPointerDown={stopButtonEvent}
              onClick={(event) => {
                event.stopPropagation()
                onArrange()
              }}
            >
              {node.state === 'unprepared' ? '去安排' : '编辑'}
            </button>
          ) : canToggle ? (
            <button
              className={`today-stack-complete${node.completed ? ' is-undo' : ''}${focused ? ' today-focus-action' : ''}`}
              type="button"
              disabled={saving}
              aria-label={`${node.title}${nodeActionLabel(node)}`}
              onPointerDown={stopButtonEvent}
              onClick={(event) => {
                event.stopPropagation()
                onToggle()
              }}
            >
              {saving ? '…' : nodeActionLabel(node)}
            </button>
          ) : node.state === 'readonly' ? (
            <span className="today-stack-readonly">只读</span>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export function TodayStack({
  route,
  progress,
  prepare,
  saving,
  saveError,
  canRetry,
  onRetry,
  onToggle,
  onArrange,
  onCopyYesterday,
  onAddTask,
  onEditTask,
  onDeleteTask,
}: {
  route: TodayRoute
  progress: number
  prepare: boolean
  saving: boolean
  saveError: string | null
  canRetry: boolean
  onRetry: () => void
  onToggle: (node: TodayRouteNode) => void
  onArrange: (node: TodayRouteNode) => void
  onCopyYesterday: () => void
  onAddTask: () => void
  onEditTask: (node: TodayRouteNode) => void
  onDeleteTask: (node: TodayRouteNode) => void
}) {
  const [view, setView] = useState<StackView>('stacked')
  const gestureRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const didGestureRef = useRef(false)
  const focusIndex = route.focus ? route.nodes.findIndex((node) => node.id === route.focus?.id) : -1
  const stackTop = focusIndex >= 0
    ? route.nodes[focusIndex]
    : route.nodes.find((node) => node.completionTarget) ?? route.nodes[0]
  const stackTopIndex = stackTop ? route.nodes.findIndex((node) => node.id === stackTop.id) : -1
  const stackedNodes = stackTopIndex >= 0
    ? [stackTop, ...route.nodes.filter((_, index) => index !== stackTopIndex)]
    : route.nodes
  const writable = !route.readonly
  const allComplete = route.nodes.length > 0 &&
    route.nodes.every((node) => node.completed || (!node.completionTarget && node.state !== 'unprepared'))
  const fieldStyle = {
    '--today-expanded-height': `${Math.max(360, 138 + route.nodes.length * 118 + 36)}px`,
    '--today-expanded-height-mobile': `${Math.max(360, 118 + route.nodes.length * 128 + 36)}px`,
  } as CSSProperties

  function selectCard(node: TodayRouteNode) {
    if (view === 'stacked') {
      if (didGestureRef.current) {
        didGestureRef.current = false
        return
      }
      setView('expanded')
      return
    }
    if (node.editorTarget && node.state === 'unprepared') onArrange(node)
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (view !== 'stacked' || !route.focus || !route.focus.completionTarget || route.focus.completed || !writable || saving) return
    if (!event.isPrimary || event.button !== 0 || event.target instanceof Element && event.target.closest('button')) return
    gestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic pointer events used by accessibility checks do not own a browser pointer.
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLElement>) {
    const origin = gestureRef.current
    gestureRef.current = null
    if (!origin || origin.pointerId !== event.pointerId || !route.focus) return
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    if (dx >= 72 && dx > Math.abs(dy)) {
      didGestureRef.current = true
      onToggle(route.focus)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setView((current) => current === 'stacked' ? 'expanded' : 'stacked')
    }
  }

  return (
    <section
      className={`today-stack today-route${view === 'expanded' ? ' is-expanded' : ''}`}
      aria-label="今日事项堆叠"
      data-testid="today-route"
    >
      <div className={`today-stack-toolbar${prepare ? ' has-progress' : ''}`}>
        {prepare ? <span className="today-stack-progress">明日准备进度 {progress}/5</span> : null}
        {writable ? (
          <>
            <button className="today-stack-copy" type="button" disabled={saving} onClick={onCopyYesterday}>
              复制昨天
            </button>
            <button className="today-stack-add" type="button" disabled={saving} onClick={onAddTask}>
              ＋ 添加自定义事项
            </button>
          </>
        ) : null}
      </div>

      {view === 'expanded' && (saving || saveError) ? (
        <div className={`today-stack-save-state${saveError ? ' is-error' : ''}`} role={saveError ? 'alert' : 'status'}>
          <span>{saveError ? `本地保存失败：${saveError}` : '正在保存到本地…'}</span>
          {saveError && canRetry ? <button type="button" onClick={onRetry}>重试</button> : null}
        </div>
      ) : null}

      {route.nodes.length ? (
        <ol className={`route-list today-stack-compat-route${prepare ? ' prep-list' : ''}`} aria-hidden="true">
          {route.nodes.map((node) => {
            const canToggle = writable && !saving && Boolean(node.completionTarget)
            const canEdit = writable && !saving && Boolean(node.editorTarget)
            return (
              <li className="route-stop" key={`compat-${node.id}`}>
                <div
                  className={`${legacyRowClass(node)} today-stack-compat-row`}
                  data-node-id={node.id}
                  data-node-state={node.state}
                  data-routine={node.kind === 'routine' ? node.routineKind : undefined}
                >
                  {node.completionTarget ? (
                    <input
                      type="checkbox"
                      checked={node.completed}
                      disabled={!canToggle || saving}
                      tabIndex={-1}
                      aria-label={legacyCompletionLabel(node)}
                      onChange={() => onToggle(node)}
                    />
                  ) : null}
                  {canEdit ? (
                    <button
                      className="row-main"
                      type="button"
                      disabled={!canEdit}
                      tabIndex={-1}
                      onClick={() => onArrange(node)}
                    >
                      <strong>{node.title}</strong>
                      {node.detail ? <span>{node.detail}</span> : null}
                    </button>
                  ) : (
                    <span className="route-node-copy">
                      <strong>{node.title}</strong>
                      {node.detail ? <small>{node.detail}</small> : null}
                    </span>
                  )}
                  {node.kind === 'custom-task' && writable ? (
                    <>
                      <button className="secondary mini" type="button" tabIndex={-1} onClick={() => onEditTask(node)}>
                        编辑
                      </button>
                      <button className="secondary mini" type="button" tabIndex={-1} onClick={() => onDeleteTask(node)}>
                        删除
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      ) : null}

      {prepare ? (
        <div className="progress-head today-stack-compat-progress" aria-hidden="true">
          <strong>明日准备进度 {progress}/5</strong>
        </div>
      ) : null}

      {writable ? (
        <button
          className="task-add-button today-stack-compat-add"
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={onAddTask}
        >
          ＋ 添加事项
        </button>
      ) : null}

      <div
        className={`today-stack-surface is-${view}`}
        tabIndex={0}
        role="application"
        aria-label="今日卡片堆叠，可用回车展开或收起"
        onKeyDown={handleKeyDown}
      >
        {view === 'expanded' ? (
          <button
            className="today-stack-collapse"
            type="button"
            aria-label="收起今日事项卡片"
            onClick={() => setView('stacked')}
          >
            收起
          </button>
        ) : null}

        {route.nodes.length ? (
          <div className="today-stack-card-field" style={fieldStyle}>
            {view === 'stacked'
              ? stackedNodes.map((node) => {
                  const index = route.nodes.findIndex((item) => item.id === node.id)
                  return (
                    <StackCard
                      key={node.id}
                      node={node}
                      index={index}
                      stackIndex={stackedNodes.findIndex((item) => item.id === node.id)}
                      view={view}
                      focused={node.id === stackTop?.id}
                      saving={saving}
                      writable={writable}
                      onSelect={() => selectCard(node)}
                      onToggle={() => onToggle(node)}
                      onArrange={() => onArrange(node)}
                      onEditTask={() => onEditTask(node)}
                      onDeleteTask={() => onDeleteTask(node)}
                      onPointerDown={node.id === stackTop?.id ? handlePointerDown : undefined}
                      onPointerUp={node.id === stackTop?.id ? handlePointerUp : undefined}
                      onPointerCancel={() => { gestureRef.current = null }}
                    />
                  )
                })
              : route.nodes.map((node, index) => (
                  <StackCard
                    key={node.id}
                    node={node}
                    index={index}
                    stackIndex={index}
                    view={view}
                    focused={node.id === route.focus?.id}
                    saving={saving}
                    writable={writable}
                    onSelect={() => selectCard(node)}
                    onToggle={() => onToggle(node)}
                    onArrange={() => onArrange(node)}
                    onEditTask={() => onEditTask(node)}
                    onDeleteTask={() => onDeleteTask(node)}
                  />
                ))}
          </div>
        ) : (
          <div className="today-stack-empty">
            <span className="today-stack-empty-mark" aria-hidden="true">✦</span>
            <strong>{prepare ? '还没有需要准备的内容' : '今天还没有安排内容'}</strong>
            <p>{prepare ? '可以从三餐、晨间或健身安排开始。' : '从一件小事开始就好，不着急。'}</p>
          </div>
        )}

        {view === 'stacked' && route.focus && route.focus.completionTarget && !route.focus.completed && writable ? (
          <p className="today-stack-gesture-hint">向右滑动焦点卡，也可以完成</p>
        ) : null}
        {allComplete && !route.readonly ? (
          <p className="today-stack-complete-note">
            {prepare ? '明天的准备都完成了。' : '今天的安排都完成了，慢慢收好这一天。'}
          </p>
        ) : null}
      </div>

    </section>
  )
}
