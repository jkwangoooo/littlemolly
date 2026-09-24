import type { MealType } from '../../../shared/types/dayPlan'
import { MEAL_TYPES } from '../../../shared/types/dayPlan'
import { MEAL_NAMES, MEAL_NOTE_LABEL, PICKER_EMPTY } from '../dayPlanLabels'
import type { MealDraft } from '../panelDrafts'
import { ItemPicker, type PickerOption } from './ItemPicker'

/** 三餐面板：按早 / 中 / 晚分组多选常用食物，每餐可写备注。 */
export function MealPanel({
  draft,
  options,
  disabled,
  onChange,
}: {
  draft: MealDraft
  options: PickerOption[]
  disabled: boolean
  onChange: (type: MealType, patch: Partial<MealDraft[MealType]>) => void
}) {
  return (
    <>
      {MEAL_TYPES.map((type) => (
        <div className="panel-group" data-meal={type} key={type}>
          <p className="panel-group-label">{MEAL_NAMES[type]}</p>
          <ItemPicker
            options={options}
            value={draft[type].items}
            emptyHint={PICKER_EMPTY.food}
            disabled={disabled}
            onChange={(items) => onChange(type, { items })}
          />
          <label className="field">
            {`${MEAL_NAMES[type]}${MEAL_NOTE_LABEL}`}
            <input
              value={draft[type].note}
              disabled={disabled}
              onChange={(event) => onChange(type, { note: event.target.value })}
            />
          </label>
        </div>
      ))}
    </>
  )
}
