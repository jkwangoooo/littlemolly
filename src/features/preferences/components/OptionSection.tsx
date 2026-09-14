import type { AnyOption, OptionKind } from '../../../shared/types/options'
import { OPTION_ADD_LABEL, OPTION_EMPTY_TEXT, OPTION_KIND_TITLE } from '../preferencesLabels'
import { OptionRow } from './OptionRow'

/**
 * 一个分组（例如「早」时段的补剂，或整类食物）。分组只为展示，排序仍由服务层按 sort_order 决定。
 * 空状态只在所有分组都为空时出现，避免补剂页出现三个空分组各说一遍。
 */
export type OptionGroup = {
  key: string
  label?: string
  options: AnyOption[]
  detail?: (option: AnyOption) => string
}

export function OptionSection({
  kind,
  groups,
  selectableCount,
  busy,
  onAdd,
  onMove,
  onToggleActive,
  onRename,
  onDelete,
}: {
  kind: OptionKind
  groups: OptionGroup[]
  selectableCount: number
  busy: boolean
  onAdd: () => void
  onMove: (option: AnyOption, delta: -1 | 1) => void
  onToggleActive: (option: AnyOption) => void
  onRename: (option: AnyOption) => void
  onDelete: (option: AnyOption) => void
}) {
  const total = groups.reduce((sum, group) => sum + group.options.length, 0)
  const isEmpty = total === 0

  return (
    <section className="option-section" data-option-kind={kind}>
      <div className="timeline-head">
        <h3>{OPTION_KIND_TITLE[kind]}</h3>
        <button type="button" disabled={busy} onClick={onAdd}>
          {OPTION_ADD_LABEL[kind]}
        </button>
      </div>

      {isEmpty ? (
        <p className="muted option-empty">{OPTION_EMPTY_TEXT[kind]}</p>
      ) : (
        <p className="option-summary">
          启用 {selectableCount} 项 · 停用 {total - selectableCount} 项
        </p>
      )}

      {isEmpty
        ? null
        : groups.map((group) => (
            <div className="option-group" key={group.key}>
              {group.label ? <p className="option-group-label">{group.label}</p> : null}
              {group.options.map((option, index) => (
                <OptionRow
                  key={option.id}
                  option={option}
                  detail={group.detail?.(option)}
                  canMoveUp={index > 0}
                  canMoveDown={index < group.options.length - 1}
                  busy={busy}
                  onMove={(delta) => onMove(option, delta)}
                  onToggleActive={() => onToggleActive(option)}
                  onRename={() => onRename(option)}
                  onDelete={() => onDelete(option)}
                />
              ))}
            </div>
          ))}
    </section>
  )
}
