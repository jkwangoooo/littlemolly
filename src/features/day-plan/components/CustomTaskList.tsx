import type { CustomTask } from '../../../shared/types/dayPlan'

/**
 * 自定义时间线事项，按时间升序显示。历史日期只渲染内容，不渲染任何编辑入口。
 */
export function CustomTaskList({
  tasks,
  writable,
  onAdd,
  onEdit,
  onRequestDelete,
  onToggle,
}: {
  tasks: CustomTask[]
  writable: boolean
  onAdd: () => void
  onEdit: (task: CustomTask) => void
  onRequestDelete: (task: CustomTask) => void
  onToggle: (id: string) => void
}) {
  return (
    <>
      <div className="timeline-head">
        <h3>自定义事项</h3>
        {writable ? (
          <button type="button" onClick={onAdd}>
            ＋ 添加事项
          </button>
        ) : null}
      </div>

      {tasks.map((task) => (
        <div className="execution-row task-row" key={task.id}>
          <input
            type="checkbox"
            checked={task.completed}
            disabled={!writable}
            aria-label={`${task.title} 完成`}
            onChange={() => onToggle(task.id)}
          />
          <span>
            <strong>
              {task.task_time.slice(0, 5)} · {task.title}
            </strong>
            <small>{task.note}</small>
          </span>
          {writable ? (
            <button className="secondary mini" type="button" onClick={() => onEdit(task)}>
              编辑
            </button>
          ) : null}
          {writable ? (
            <button className="secondary mini" type="button" onClick={() => onRequestDelete(task)}>
              删除
            </button>
          ) : null}
        </div>
      ))}
    </>
  )
}
