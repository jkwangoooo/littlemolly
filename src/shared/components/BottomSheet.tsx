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
 *
 * 结构上刻意分三层：**标题固定、中间 `.sheet-body` 独立滚动、操作区钉在底部**。
 * 原因是软键盘：iOS 弹键盘时只缩小可视视口，面板高度被压到很矮，
 * 如果整个面板一起滚，「保存 / 取消」会正好落在键盘底下，用户既看不到也点不到
 * （面板开着时 body 滚动是锁住的，连滚都滚不出来）。钉住操作区之后，
 * 无论键盘多高，保存永远可见。高度上限与让位量来自 `--vv-height` / `--vv-keyboard-inset`，
 * 由 src/shared/appShell/visualViewport.ts 同步。
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
        <div className="sheet-body">{children}</div>
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
