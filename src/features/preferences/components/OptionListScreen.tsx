import { useRef } from 'react'
import type { AnyOption, OptionKind } from '../../../shared/types/options'
import { OPTION_ADD_LABEL, OPTION_EMPTY_TEXT, OPTION_PAGE_HINT } from '../preferencesLabels'
import { useDragOrder } from '../useDragOrder'
import { OptionRow } from './OptionRow'

/**
 * 一个清单分组（例如「早」时段的补剂，或整类食物）。分组只为展示，排序仍由服务层按 sort_order 决定。
 * 空状态只在所有分组都为空时出现，避免补剂子屏出现三个空分组各说一遍。
 */
export type OptionListGroup = {
  key: string
  label?: string
  options: AnyOption[]
  detail?: (option: AnyOption) => string
}

/**
 * 单个清单的子屏（docs/17 §4.2）。
 *
 * 与旧版「三份清单平铺在一页」的区别：
 * - 一次只呈现一类清单，标题在顶栏、返回入口在左上，用户始终知道自己在哪一层；
 * - 行内只留拖拽手柄与「…」菜单，行高从 102px 降到约 56px；
 * - 排序改为拖拽（手柄），菜单里保留上移 / 下移作为无障碍替代。
 */
export function OptionListScreen({
  kind,
  groups,
  selectableCount,
  busy,
  onAdd,
  onReorder,
  onMove,
  onToggleActive,
  onRename,
  onDelete,
}: {
  kind: OptionKind
  groups: OptionListGroup[]
  selectableCount: number
  busy: boolean
  onAdd: () => void
  /** 拖拽提交：把某一项在组内移动 delta 位（正数向下）。父组件负责保存与重新读取。 */
  onReorder: (id: string, delta: number) => Promise<void>
  onMove: (option: AnyOption, delta: -1 | 1) => void
  onToggleActive: (option: AnyOption) => void
  onRename: (option: AnyOption) => void
  onDelete: (option: AnyOption) => void
}) {
  const containerRef = useRef<HTMLElement>(null)
  const { draggingId, orderOf, handleProps } = useDragOrder({ containerRef, onCommit: onReorder })

  const total = groups.reduce((sum, group) => sum + group.options.length, 0)
  const isEmpty = total === 0

  return (
    <section className="option-section" data-option-kind={kind} ref={containerRef}>
      <div className="option-list-head">
        <p className="option-summary">
          {isEmpty ? '还没有选项' : `启用 ${selectableCount} 项 · 停用 ${total - selectableCount} 项`}
        </p>
        <button type="button" disabled={busy} onClick={onAdd}>
          {OPTION_ADD_LABEL[kind]}
        </button>
      </div>

      {isEmpty ? <p className="muted option-empty">{OPTION_EMPTY_TEXT[kind]}</p> : null}

      {/* 停用语义说明放在清单屏：用户要停用某项时正好看到，概览页不必背这段文字。 */}
      {isEmpty ? null : <p className="muted option-hint">{OPTION_PAGE_HINT}</p>}

      {groups.map((group) => {
        // 拖拽期间用乐观顺序渲染，松手并保存成功后由父组件重新读取、自然回到服务层顺序。
        const ids = orderOf(group.key) ?? group.options.map((option) => option.id)
        const byId = new Map(group.options.map((option) => [option.id, option]))
        const ordered = ids.map((id) => byId.get(id)).filter((option): option is AnyOption => Boolean(option))

        return (
          <div className="option-group" key={group.key}>
            {group.label ? <p className="option-group-label">{group.label}</p> : null}
            {ordered.map((option, index) => (
              <OptionRow
                key={option.id}
                option={option}
                detail={group.detail?.(option)}
                group={group.key}
                dragging={draggingId === option.id}
                canMoveUp={index > 0}
                canMoveDown={index < ordered.length - 1}
                busy={busy}
                dragHandleProps={handleProps(option.id, group.key, ids)}
                onMove={(delta) => onMove(option, delta)}
                onToggleActive={() => onToggleActive(option)}
                onRename={() => onRename(option)}
                onDelete={() => onDelete(option)}
              />
            ))}
          </div>
        )
      })}
    </section>
  )
}
