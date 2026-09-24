import type { DayPlan } from '../../../shared/types/dayPlan'
import { EXERCISE_PANEL, PICKER_EMPTY } from '../dayPlanLabels'
import type { ExerciseDraft } from '../panelDrafts'
import { ItemPicker, type PickerOption } from './ItemPicker'

/** 下拉框的固定顺序，不依赖对象键顺序。 */
const DECISIONS: Array<DayPlan['exercise_decision']> = ['undecided', 'exercise', 'rest']

/**
 * 健身面板：决定（健身 / 不健身 / 未决定）+ 多选项目 + 备注。
 *
 * 选「不健身」不清空已选项目：项目是内容，决定是安排。切回健身时原样还在，
 * 执行页也只在决定为「健身」时才展示这一行（docs/01 不变量 6）。
 */
export function ExercisePanel({
  draft,
  options,
  disabled,
  onChange,
}: {
  draft: ExerciseDraft
  options: PickerOption[]
  disabled: boolean
  onChange: (patch: Partial<ExerciseDraft>) => void
}) {
  return (
    <>
      <label className="field">
        {EXERCISE_PANEL.decisionLabel}
        <select
          value={draft.decision}
          disabled={disabled}
          onChange={(event) => onChange({ decision: event.target.value as DayPlan['exercise_decision'] })}
        >
          {DECISIONS.map((decision) => (
            <option value={decision} key={decision}>
              {EXERCISE_PANEL.decisionOptions[decision]}
            </option>
          ))}
        </select>
      </label>

      <div className="panel-group">
        <p className="panel-group-label">{EXERCISE_PANEL.itemsLabel}</p>
        <ItemPicker
          options={options}
          value={draft.items}
          emptyHint={PICKER_EMPTY.exercise}
          disabled={disabled}
          onChange={(items) => onChange({ items })}
        />
      </div>

      <label className="field">
        {EXERCISE_PANEL.noteLabel}
        <input value={draft.note} disabled={disabled} onChange={(event) => onChange({ note: event.target.value })} />
      </label>
    </>
  )
}
