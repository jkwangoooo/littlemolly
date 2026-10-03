import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { TodayRoute as Route, TodayRouteNode } from './todayRouteModel'
import './todayStage.css'
import './todayBubbleMotion.css'

const STATUS: Record<TodayRouteNode['state'], string> = { completed: '已完成', current: '现在完成', upcoming: '待完成', unprepared: '尚未安排', readonly: '只读' }
const icon = (node: TodayRouteNode) => node.kind === 'meal' ? '◒' : node.kind === 'supplement' ? '✦' : node.kind === 'exercise' ? '↗' : node.kind === 'morning' ? '☼' : node.kind === 'routine' ? '⌂' : node.kind === 'custom-task' ? '○' : '□'
const tone = (node: TodayRouteNode) => node.state === 'unprepared' ? 'muted' : node.kind === 'meal' ? 'meal' : node.kind === 'supplement' ? 'supplement' : node.kind === 'exercise' ? 'exercise' : node.kind === 'custom-task' ? 'custom' : 'morning'

export function TodayBubbleStage({ route, prepare, progress, saving, saveError, canRetry, onRetry, onToggle, onArrange, onCopyYesterday, onEditTask, onDeleteTask }: {
  route: Route; prepare: boolean; progress: number; saving: boolean; saveError: string | null; canRetry: boolean; onRetry: () => void
  onToggle: (node: TodayRouteNode) => void; onArrange: (node: TodayRouteNode) => void; onCopyYesterday: () => void
  onEditTask: (node: TodayRouteNode) => void; onDeleteTask: (node: TodayRouteNode) => void
}) {
  const [selected, setSelected] = useState<TodayRouteNode | null>(null)
  const [pressed, setPressed] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const pressRef = useRef<{ pointerId: number; x: number; y: number; timer: ReturnType<typeof setTimeout> | null; long: boolean } | null>(null)
  const fixed = route.nodes.filter((node) => node.kind !== 'custom-task')
  const tasks = route.nodes.filter((node) => node.kind === 'custom-task')
  const visible = useMemo(() => [...fixed, ...tasks.slice(0, 3)], [fixed, tasks])
  const executable = route.nodes.filter((node) => node.kind !== 'prep' && node.state !== 'readonly')
  const total = prepare ? 5 : executable.length
  const done = prepare ? progress : executable.filter((node) => node.completed).length
  function clearPress() { if (pressRef.current?.timer) clearTimeout(pressRef.current.timer); pressRef.current = null; setPressed(null) }
  function completeOrExplain(node: TodayRouteNode) {
    if ('vibrate' in navigator) navigator.vibrate(12)
    if (node.state === 'unprepared' || node.completed) setSelected(node)
    else if (node.completionTarget && !route.readonly) onToggle(node)
  }
  function down(node: TodayRouteNode, event: PointerEvent<HTMLButtonElement>) {
    if (saving || route.readonly || event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const value = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: null as ReturnType<typeof setTimeout> | null, long: false }
    value.timer = setTimeout(() => { value.long = true; completeOrExplain(node); setPressed(null) }, 500)
    pressRef.current = value; setPressed(node.id)
  }
  function move(event: PointerEvent<HTMLButtonElement>) { const value = pressRef.current; if (!value || value.pointerId !== event.pointerId) return; if (Math.hypot(event.clientX - value.x, event.clientY - value.y) > 10) clearPress() }
  function up(node: TodayRouteNode, event: PointerEvent<HTMLButtonElement>) { const value = pressRef.current; if (!value || value.pointerId !== event.pointerId) return; event.currentTarget.releasePointerCapture?.(event.pointerId); const didLong = value.long; clearPress(); if (!didLong) setSelected(node) }
  function act() { if (!selected) return; if (selected.state === 'unprepared') onArrange(selected); else if (selected.completionTarget) onToggle(selected); setSelected(null) }
  function editSelected() {
    if (!selected || !selected.editorTarget || route.readonly) return
    const node = selected
    setSelected(null)
    onArrange(node)
  }
  return <section className="bubble-stage" aria-label={prepare ? '准备明天' : '执行今天'}>
    <div className="bubble-stage-toolbar"><div>{prepare ? <span>还差 {Math.max(0, 5 - progress)} 项准备</span> : null}</div><div>{prepare ? <button type="button" onClick={onCopyYesterday} disabled={saving || route.readonly}>复制昨天</button> : null}</div></div>
<div className="bubble-canvas"><div className="bubble-orbit orbit-a" aria-hidden="true"/><div className="bubble-orbit orbit-b" aria-hidden="true"/>{visible.map((node, index) => { const angle = -Math.PI / 2 + 2 * Math.PI * index / visible.length; const radius = window.innerWidth <= 480 ? Math.min(132, Math.max(106, window.innerWidth * 0.28)) : Math.min(170, Math.max(115, window.innerWidth * 0.29)); const orbitAngle = angle + [-0.045, 0.025, -0.035, 0.05, -0.02, 0.04, -0.05, 0.03, -0.025][index % 9]; const orbitRadius = radius + [-5, 4, 7, -3, 6, -6, 3, -4, 5][index % 9]; return <button key={node.id} type="button" className={`rhythm-bubble ${tone(node)} ${node.state}${pressed === node.id ? ' pressing' : ''}`} style={{ transform: `translate(${Math.cos(orbitAngle) * orbitRadius}px, ${Math.sin(orbitAngle) * orbitRadius}px)`, "--bubble-index": index } as CSSProperties} data-node-id={node.id} data-node-state={node.state} aria-label={`${node.title}，${STATUS[node.state]}`} onPointerDown={(event) => down(node, event)} onPointerMove={move} onPointerUp={(event) => up(node, event)} onPointerCancel={clearPress}><span className="bubble-icon">{icon(node)}{node.completed ? <span className="bubble-check" aria-hidden="true" /> : null}</span><strong>{node.title}</strong><small>{STATUS[node.state]}</small></button> })}<div className="progress-orb"><div className="progress-ring" style={{ '--progress': `${total ? done / total * 100 : 0}%` } as CSSProperties}><strong>{done}<small>/{total}</small></strong><span>{prepare ? '已安排' : '已完成'}</span><em>{done === total && total ? (prepare ? '明天已经准备好' : '今天做得很好') : route.focus?.state === 'unprepared' ? '先去安排这一项' : '现在完成一项'}</em></div></div><span className="bubble-speck speck-a"/><span className="bubble-speck speck-b"/></div>
    {tasks.length > 3 || tasks.some((node) => !node.task?.task_time) ? <section className="my-tasks-entry"><strong>我的事项 · {tasks.length} 项</strong><button type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? '收起' : '查看全部'}</button></section> : null}
    {showAll ? <div className="my-tasks-list">{tasks.map((node) => <div className="my-task-row" key={node.id}><button type="button" onClick={() => setSelected(node)}><strong>{node.title}</strong><span>{STATUS[node.state]}{node.detail ? ` · ${node.detail}` : ''}</span></button>{!route.readonly ? <button type="button" onClick={() => onEditTask(node)}>编辑</button> : null}{!route.readonly ? <button type="button" onClick={() => onDeleteTask(node)}>删除</button> : null}</div>)}</div> : null}
    {saveError || saving ? <div className={`bubble-save-status${saveError ? ' error' : ''}`} role={saveError ? 'alert' : 'status'}>{saveError ? '保存失败，请重试' : '正在保存到本地…'}{saveError && canRetry ? <button type="button" onClick={onRetry}>重试</button> : null}</div> : null}
    {selected ? createPortal(<div className="bubble-detail-backdrop" onClick={() => setSelected(null)}><section className="bubble-detail-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><p>{selected.kind === 'custom-task' ? '我的事项' : prepare ? '准备明天' : '执行今天'}</p><h3>{selected.title}</h3><strong>{STATUS[selected.state]}</strong><dl><div><dt>类型</dt><dd>{selected.kind}</dd></div><div><dt>时间 / 备注</dt><dd>{selected.task?.task_time ? `${selected.task.task_time.slice(0, 5)} · ` : ''}{selected.detail || '未填写'}</dd></div></dl><div><button className="bubble-detail-primary" type="button" onClick={act}>{selected.state === 'unprepared' ? '去安排' : selected.completed ? '确认撤销完成' : '完成'}</button>{selected.editorTarget && !route.readonly ? <button type="button" className="secondary" onClick={editSelected}>编辑</button> : null}<button type="button" className="secondary" onClick={() => setSelected(null)}>关闭</button></div></section></div>, document.body) : null}
  </section>
}
