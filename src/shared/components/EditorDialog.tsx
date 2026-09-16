import { useEffect, type ReactNode } from 'react'

/**
 * 编辑弹层：统一的标题、内容区与「保存 / 取消」操作区，两种形态共用同一套结构与规则。
 *
 * - `placement="bottom"`（默认）：底部抽屉。内容多、需要单手够到下方操作区的场景（三餐 / 补剂 /
 *   健身 / 晨间 / 选项编辑）用它，长表单在抽屉里更舒展。
 * - `placement="center"`：居中卡片。字段少的短表单（添加 / 编辑自定义事项）用它——
 *   居中更聚焦，也不必让用户把视线甩到屏幕最下方。
 *
 * 两种形态共享两条硬规则，改这里时两条都不能丢：
 *
 * 1. **结构分三层：标题固定、中间 `.editor-body` 独立滚动、操作区钉底。**
 *    原因是软键盘：iOS 弹键盘时只缩小可视视口，弹层高度被压得很矮，如果整块一起滚，
 *    「保存 / 取消」会正好落在键盘底下，用户既看不到也点不到（弹层打开时 body 滚动是锁住的，
 *    连滚都滚不出来）。钉住操作区之后，无论键盘多高，保存永远可见。
 * 2. **打开时锁定 body 滚动，卸载时恢复。** 弹层是固定遮罩，不锁的话背景仍可滚动，
 *    关闭后位置会漂。
 *
 * 高度上限与让位量来自 `--vv-height` / `--vv-keyboard-inset`，由
 * src/shared/appShell/visualViewport.ts 同步（见 styles.css 弹层段）。
 *
 * `data-editor-card` 是给验收脚本用的稳定钩子：形态换了（抽屉 ↔ 卡片），
 * 脚本不必跟着改选择器。
 */
export function EditorDialog({
  title,
  placement = 'bottom',
  saveLabel = '保存',
  cancelLabel = '取消',
  saveDisabled = false,
  onSave,
  onCancel,
  children,
}: {
  title: string
  placement?: 'bottom' | 'center'
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

  const actions = (
    <div className="actions">
      <button type="button" disabled={saveDisabled} onClick={onSave}>
        {saveLabel}
      </button>
      <button className="secondary" type="button" onClick={onCancel}>
        {cancelLabel}
      </button>
    </div>
  )

  if (placement === 'center') {
    return (
      <div className="modal-backdrop">
        <section className="center-card" role="dialog" aria-modal="true" aria-label={title} data-editor-card>
          <h2>{title}</h2>
          <div className="editor-body">{children}</div>
          {actions}
        </section>
      </div>
    )
  }

  return (
    <div className="sheet-backdrop">
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label={title} data-editor-card>
        <div className="sheet-handle" />
        <h2>{title}</h2>
        <div className="editor-body">{children}</div>
        {actions}
      </section>
    </div>
  )
}
