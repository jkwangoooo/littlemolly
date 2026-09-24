import { useRef } from 'react'
import type { TodayRouteNode } from './todayRouteModel'

export function TodayFocusCard({
  focus,
  readonly,
  saving,
  allComplete,
  prepare,
  onComplete,
  onArrange,
}: {
  focus: TodayRouteNode | null
  readonly: boolean
  saving: boolean
  allComplete: boolean
  prepare: boolean
  onComplete: (node: TodayRouteNode) => void
  onArrange: (node: TodayRouteNode) => void
}) {
  const start = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const canComplete = Boolean(focus?.completionTarget && !focus.completed && !readonly && !saving)
  const needsArrangement = focus?.state === 'unprepared'
  const canArrange = Boolean(needsArrangement && focus?.editorTarget && !readonly && !saving)

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (!canComplete || !event.isPrimary || event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button, input, a')) return
    start.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLElement>) {
    const origin = start.current
    start.current = null
    if (!origin || origin.pointerId !== event.pointerId || !focus || !canComplete) return
    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    if (dx >= 72 && dx > Math.abs(dy)) onComplete(focus)
  }

  return (
    <section
      className={`today-focus${focus?.state === 'unprepared' ? ' is-unprepared' : ''}`}
      aria-labelledby="today-focus-title"
      data-focus-id={focus?.id ?? 'complete'}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { start.current = null }}
    >
      <div className="today-focus-copy">
        <p className="section-kicker">{readonly ? '这一天的记录' : '沿着今天的节奏'}</p>
        <h2 id="today-focus-title">
          {readonly
            ? '历史计划仅供查看'
            : focus
              ? focus.state === 'unprepared' ? '先把这一项安排好' : '现在可以处理'
              : allComplete ? (prepare ? '明天的准备都完成了' : '今天的安排都完成了') : '从一件小事开始'}
        </h2>
        {focus ? (
          <>
            <strong className="today-focus-item">{focus.title}</strong>
            {focus.detail ? <p className="today-focus-detail">{focus.detail}</p> : null}
          </>
        ) : (
          <p className="today-focus-detail">
            {readonly ? '已保存的内容不会在这里更改。' : allComplete ? '按自己的节奏，今天就到这里。' : '安排一件想做的事。'}
          </p>
        )}
      </div>
      {focus && saving ? (
        <button className="today-focus-action" type="button" disabled>正在保存</button>
      ) : focus && canArrange ? (
        <button className="today-focus-action secondary" type="button" onClick={() => onArrange(focus)}>
          去安排
        </button>
      ) : focus && canComplete ? (
        <button className="today-focus-action" type="button" onClick={() => onComplete(focus)}>
          完成
        </button>
      ) : readonly ? (
        <span className="today-focus-readonly">只读</span>
      ) : null}
    </section>
  )
}
