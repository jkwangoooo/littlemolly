import type { TodayRouteNode } from './todayRouteModel'

export function TodayRoute({
  nodes,
  writable,
  saving,
  prepare,
  progress,
  onToggle,
  onArrange,
  onAddTask,
  onEditTask,
  onDeleteTask,
}: {
  nodes: TodayRouteNode[]
  writable: boolean
  saving: boolean
  prepare: boolean
  progress: number
  onToggle: (node: TodayRouteNode) => void
  onArrange: (node: TodayRouteNode) => void
  onAddTask: () => void
  onEditTask: (node: TodayRouteNode) => void
  onDeleteTask: (node: TodayRouteNode) => void
}) {
  const primary = nodes.filter((item) => item.kind !== 'custom-task')
  const tasks = nodes.filter((item) => item.kind === 'custom-task')

  function renderNode(item: TodayRouteNode) {
    const canToggle = writable && !saving && Boolean(item.completionTarget)
    const canArrange = writable && !saving && Boolean(item.editorTarget)
    const classes = `route-node route-node-${item.state}${item.completed ? ' is-completed' : ''}`

    if (item.kind === 'prep') {
      return (
        <li className="route-stop" key={item.id}>
          <div className={`prep-row ${classes}`} data-node-id={item.id} data-node-state={item.state}>
            <input
              type="checkbox"
              checked={item.completed}
              disabled={!canToggle}
              aria-label={item.title}
              onChange={() => onToggle(item)}
            />
            <button
              className="row-main route-node-copy"
              type="button"
              disabled={!item.editorTarget || !writable || saving}
              onClick={() => onArrange(item)}
            >
              <strong>{item.title}</strong>
              {item.detail ? <span>{item.detail}</span> : null}
            </button>
            {item.editorTarget && writable ? <span className="arrow" aria-hidden="true">›</span> : null}
          </div>
        </li>
      )
    }

    if (item.kind === 'custom-task') {
      return (
        <li className="route-stop" key={item.id}>
          <div
            className={`execution-row task-row ${classes}`}
            data-node-id={item.id}
            data-node-state={item.state}
          >
            <input
              type="checkbox"
              checked={item.completed}
              disabled={!canToggle}
              aria-label={`${item.task?.title ?? item.title} 完成`}
              onChange={() => onToggle(item)}
            />
            <span className="route-node-copy">
              <strong>{item.title}</strong>
              {item.detail ? <small>{item.detail}</small> : null}
            </span>
            {writable ? (
              <>
                <button className="secondary mini" type="button" onClick={() => onEditTask(item)}>
                  编辑
                </button>
                <button className="secondary mini" type="button" onClick={() => onDeleteTask(item)}>
                  删除
                </button>
              </>
            ) : null}
          </div>
        </li>
      )
    }

    if (!item.completionTarget) {
      return (
        <li className="route-stop" key={item.id}>
          <div className={`execution-row ${classes}`} data-node-id={item.id} data-node-state={item.state}>
            <span className="route-node-marker" aria-hidden="true" />
            <span className="route-node-copy">
              <strong>{item.title}</strong>
              {item.detail ? <small>{item.detail}</small> : null}
            </span>
            {canArrange ? (
              <button className="route-node-edit" type="button" onClick={() => onArrange(item)}>
                去安排
              </button>
            ) : null}
          </div>
        </li>
      )
    }

    const completionLabel = item.kind === 'routine'
      ? `${item.title}已完成`
      : item.kind === 'meal'
        ? `${item.title}已完成`
        : item.kind === 'supplement'
          ? `${item.title.split(' · ').slice(1).join(' · ')}已完成`
          : item.kind === 'exercise'
            ? '健身已完成'
            : `${item.title}已完成`
    const attributes: Record<string, string> = item.kind === 'meal'
      ? { 'data-meal': item.id.slice('meal-'.length) }
      : item.kind === 'supplement'
        ? { 'data-supplement': item.title.startsWith('早间') ? 'morning' : item.title.startsWith('午间') ? 'noon' : 'evening' }
        : item.kind === 'routine'
          ? { 'data-routine': item.routineKind ?? item.id }
          : {}

    return (
      <li className="route-stop" key={item.id}>
        <div
          className={`execution-row ${classes}`}
          data-node-id={item.id}
          data-node-state={item.state}
          {...attributes}
        >
          <input
            type="checkbox"
            checked={item.completed}
            disabled={!canToggle}
            aria-label={completionLabel}
            onChange={() => onToggle(item)}
          />
          <span className="route-node-copy">
            <strong>{item.title}</strong>
            {item.detail ? <small>{item.detail}</small> : null}
          </span>
          {item.editorTarget && writable ? (
            <button
              className="route-node-edit"
              type="button"
              aria-label={`安排${item.title}`}
              onClick={(event) => {
                event.preventDefault()
                onArrange(item)
              }}
            >
              编辑
            </button>
          ) : null}
        </div>
      </li>
    )
  }

  return (
    <section className="today-route" aria-label="今日剧情轨道" data-testid="today-route">
      <div className="route-heading">
        <div>
          <p className="section-kicker">不必按顺序完成</p>
          <h2>{prepare ? '明天的准备' : '今天的节奏'}</h2>
        </div>
      </div>
      {prepare ? (
        <div className="progress-head">
          <strong>明日准备进度 {progress}/5</strong>
          <span>{progress === 5 ? '美好的一天结束啦，迎接下一天！' : ''}</span>
        </div>
      ) : null}
      {primary.length ? <ol className={`route-list${prepare ? ' prep-list' : ''}`}>{primary.map(renderNode)}</ol> : null}
      {tasks.length ? (
        <section className="route-side-line" aria-labelledby="route-side-title">
          <div className="route-side-heading">
            <span className="route-side-mark" aria-hidden="true" />
            <h3 id="route-side-title">自定义事项</h3>
            {writable ? (
              <button className="task-add-button" type="button" disabled={saving} onClick={onAddTask}>
                ＋ 添加事项
              </button>
            ) : null}
          </div>
          <ol className="route-list route-list-side">{tasks.map(renderNode)}</ol>
        </section>
      ) : (
        <div className="route-side-heading route-side-empty">
          <span className="route-side-mark" aria-hidden="true" />
          <h3>自定义事项</h3>
          {writable ? (
            <button className="task-add-button" type="button" disabled={saving} onClick={onAddTask}>
              ＋ 添加事项
            </button>
          ) : null}
        </div>
      )}
    </section>
  )
}
