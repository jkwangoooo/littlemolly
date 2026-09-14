import { useEffect, type ReactNode } from 'react'

/**
 * 底部编辑面板外壳：统一的遮罩、拖拽条、标题与「保存 / 取消」操作区。
 * 具体字段由调用方通过 children 提供，本组件不关心编辑对象是什么。
 *
 * `saveDisabled` 给历史日期用：只读日仍可以打开面板看内容，但保存按钮不可点，
 * 而不是让用户点下去再吃一个「历史日期不可修改」的报错。
 *
 * 打开时锁定 body 滚动：面板是固定遮罩，不锁的话背景仍可滚动，关闭后位置会漂。
 * 关闭（卸载）时恢复滚动位置，面板自身的滚动独立于背景。
 */
export function BottomSheet({
  title,
  saveLabel = '保存',
  cancelLabel = '取消',
  saveDisabled = false,
  onSave,
  onCancel,
  children,
}: {
  title: string
  saveLabel?: string
  cancelLabel?: string
  saveDisabled?: boolean
  onSave: () => void
  onCancel: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  return (
    <div className="sheet-backdrop">
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" />
        <h2>{title}</h2>
        {children}
        <div className="actions">
          <button type="button" disabled={saveDisabled} onClick={onSave}>
            {saveLabel}
          </button>
          <button className="secondary" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
