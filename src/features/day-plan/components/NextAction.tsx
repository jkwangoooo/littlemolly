export type NextActionItem = {
  id: string
  label: string
  detail?: string
  completed: boolean
}

export function NextAction({
  items,
  writable,
  onComplete,
}: {
  items: NextActionItem[]
  writable: boolean
  onComplete?: (item: NextActionItem) => void
}) {
  const next = items.find((item) => !item.completed)

  return (
    <section className="next-action" aria-labelledby="next-action-title">
      <div className="next-action-heading">
        <span className="section-kicker">现在先做一件事</span>
        <h2 id="next-action-title">下一步行动</h2>
      </div>

      {items.length === 0 ? (
        <p className="muted next-action-empty">
          {writable ? '还没有安排，从一件小事开始吧。' : '这一天没有安排事项。'}
        </p>
      ) : next ? (
        <div className="next-action-body">
          <div className="next-action-copy">
            <strong>{next.label}</strong>
            {next.detail ? <span>{next.detail}</span> : null}
          </div>
          {writable && onComplete ? (
            <button className="next-action-button" type="button" onClick={() => onComplete(next)}>
              完成这件事
            </button>
          ) : (
            <span className="next-action-readonly">仅供查看</span>
          )}
        </div>
      ) : (
        <p className="next-action-complete" role="status">
          这一天的安排都完成了。
        </p>
      )}
    </section>
  )
}
