import type { ReactNode } from 'react'

/**
 * 通用确认框。所有需要二次确认的操作都走这里，不使用浏览器原生 confirm。
 * description 用于主说明，children 用于补充说明段。
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = '确认',
  onConfirm,
  onCancel,
  children,
}: {
  title: string
  description?: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}) {
  return (
    <div className="modal-backdrop">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        {children}
        <div className="actions">
          <button type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button className="secondary" type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </section>
    </div>
  )
}
