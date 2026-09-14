import type { PlanItemInput } from '../../../shared/types/dayPlan'
import { PICKER_LEGACY_NOTE, PICKER_REMOVE_LABEL } from '../dayPlanLabels'

export type PickerOption = { id: string; name: string }

/**
 * 多选内容选择器：候选来自「选项」页里启用中的项，已选内容按名称快照展示。
 *
 * 关键点是第二段「其他已选内容」：旧记录迁移来的项，以及选项被停用或删除后留下的历史选择，
 * 都不在候选清单里，但必须能看见、能移除——否则用户一编辑这一天，历史内容就被静默丢掉了
 * （docs/01 不变量 5）。
 */
export function ItemPicker({
  options,
  value,
  emptyHint,
  disabled,
  onChange,
}: {
  options: PickerOption[]
  value: PlanItemInput[]
  emptyHint: string
  disabled: boolean
  onChange: (next: PlanItemInput[]) => void
}) {
  const optionNames = new Set(options.map((option) => option.id))
  const chosen = new Set(value.map((item) => item.optionId).filter((id): id is string => Boolean(id)))
  const others = value.filter((item) => !item.optionId || !optionNames.has(item.optionId))

  return (
    <div className="picker">
      {options.length === 0 ? <p className="picker-note">{emptyHint}</p> : null}

      {options.map((option) => {
        const checked = chosen.has(option.id)
        return (
          <label className="picker-row" key={option.id}>
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() =>
                onChange(
                  checked
                    ? value.filter((item) => item.optionId !== option.id)
                    : [...value, { optionId: option.id, name: option.name }],
                )
              }
            />
            <span>{option.name}</span>
          </label>
        )
      })}

      {others.length ? (
        <div className="picker-others">
          <p className="picker-note">{PICKER_LEGACY_NOTE}</p>
          {others.map((item) => (
            <div className="picker-row" key={`other-${item.optionId ?? 'legacy'}-${item.name}`}>
              <span>{item.name}</span>
              <button
                className="secondary mini"
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((row) => row !== item))}
              >
                {PICKER_REMOVE_LABEL}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
