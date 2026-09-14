import { useState } from 'react'
import type {
  CustomTask,
  DailyExerciseItem,
  DailyMeal,
  DailyMealItem,
  DailySupplement,
  DayPlan,
  MealType,
} from '../../../shared/types/dayPlan'
import { MEAL_TYPES } from '../../../shared/types/dayPlan'
import type { ExerciseInput, MealInput, SupplementInput } from '../../../services/local/dayPlanService'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import {
  PANEL_ADD_TASK_TITLE,
  PANEL_LOADING_TEXT,
  PANEL_OPTIONS_ERROR,
  PANEL_TITLE,
} from '../dayPlanLabels'
import { usePanelOptions } from '../usePanelOptions'
import {
  appendSupplement,
  buildExerciseDraft,
  buildMealDraft,
  buildSupplementDraft,
  patchSupplement,
  removeSupplementAt,
  templateKeys,
  type ExerciseDraft,
  type MealDraft,
  type SupplementDraftRow,
} from '../panelDrafts'
import { ExercisePanel } from './ExercisePanel'
import { MealPanel } from './MealPanel'
import { SupplementPanel } from './SupplementPanel'
import type { PrepEditor } from './PrepList'

export type EditorKind = PrepEditor | 'task'

/** 面板提交的载荷。按 `kind` 判别，调用方 switch 时可以穷尽检查，不会漏掉一种面板。 */
export type PanelPayload =
  | { kind: 'meals'; meals: MealInput[] }
  | { kind: 'supplements'; rows: SupplementInput[] }
  | { kind: 'morning'; morning_focus: string }
  | { kind: 'exercise'; exercise: ExerciseInput }
  | { kind: 'task'; task: { task_time: string; title: string; note: string } }

/**
 * 底部编辑面板。只持有草稿状态并组装载荷，落库由调用方按 `kind` 转给对应服务。
 *
 * 三种「内容型」面板（三餐 / 补剂 / 健身）各自一个组件；晨间与自定义事项字段少，
 * 直接写在这里。候选项统一由 `usePanelOptions` 异步读取，读完之前不渲染面板内容，
 * 避免先闪一下空态。
 */
export function EditorSheet({
  kind,
  meals,
  mealItems,
  supplements,
  exerciseItems,
  plan,
  task,
  writable,
  onCancel,
  onSave,
}: {
  kind: EditorKind
  meals: DailyMeal[]
  mealItems: DailyMealItem[]
  supplements: DailySupplement[]
  exerciseItems: DailyExerciseItem[]
  plan: DayPlan | null
  task: CustomTask | null
  writable: boolean
  onCancel: () => void
  onSave: (payload: PanelPayload) => void
}) {
  const options = usePanelOptions(true)

  const [mealDraft, setMealDraft] = useState<MealDraft>(() => buildMealDraft(meals, mealItems))
  const [exerciseDraft, setExerciseDraft] = useState<ExerciseDraft>(() => buildExerciseDraft(plan, exerciseItems))
  const [morningFocus, setMorningFocus] = useState(plan?.morning_focus ?? '')
  const [taskTime, setTaskTime] = useState(task?.task_time?.slice(0, 5) || '08:00')
  const [taskTitle, setTaskTitle] = useState(task?.title ?? '')
  const [taskNote, setTaskNote] = useState(task?.note ?? '')

  // 补剂草稿在用户第一次改动之前保持「派生」状态：候选项是异步到的，
  // 若一开始就固化进 state，模板补进来的行会永远等不到。
  const [editedSupplements, setEditedSupplements] = useState<SupplementDraftRow[] | null>(null)
  const supplementDraft = editedSupplements ?? buildSupplementDraft(supplements, options.supplement, writable)
  const supplementTemplateKeys = templateKeys(options.supplement)

  function updateMeal(type: MealType, patch: Partial<MealDraft[MealType]>) {
    setMealDraft((current) => ({ ...current, [type]: { ...current[type], ...patch } }))
  }

  function buildPayload(): PanelPayload {
    if (kind === 'meals') {
      return {
        kind: 'meals',
        meals: MEAL_TYPES.map((type) => ({
          meal_type: type,
          note: mealDraft[type].note,
          items: mealDraft[type].items,
        })),
      }
    }
    if (kind === 'supplements') return { kind: 'supplements', rows: supplementDraft }
    if (kind === 'morning') return { kind: 'morning', morning_focus: morningFocus }
    if (kind === 'exercise') return { kind: 'exercise', exercise: exerciseDraft }
    return { kind: 'task', task: { task_time: taskTime, title: taskTitle, note: taskNote } }
  }

  const needsOptions = kind === 'meals' || kind === 'supplements' || kind === 'exercise'
  const title = kind === 'task' && !task ? PANEL_ADD_TASK_TITLE : PANEL_TITLE[kind]

  return (
    <BottomSheet
      title={title}
      saveDisabled={!writable}
      onSave={() => onSave(buildPayload())}
      onCancel={onCancel}
    >
      {needsOptions && options.loading ? (
        <p className="muted loading-note" role="status">
          {PANEL_LOADING_TEXT}
        </p>
      ) : null}

      {needsOptions && options.error ? (
        <p className="notice" role="alert">
          {PANEL_OPTIONS_ERROR}
          {options.error}
        </p>
      ) : null}

      {!needsOptions || (!options.loading && !options.error) ? (
        <>
          {kind === 'meals' ? (
            <MealPanel draft={mealDraft} options={options.food} disabled={!writable} onChange={updateMeal} />
          ) : null}

          {kind === 'supplements' ? (
            <SupplementPanel
              draft={supplementDraft}
              keys={supplementTemplateKeys}
              disabled={!writable}
              onPatch={(index, patch) => setEditedSupplements(patchSupplement(supplementDraft, index, patch))}
              onRemove={(index) => setEditedSupplements(removeSupplementAt(supplementDraft, index))}
              onAdd={(period) => setEditedSupplements(appendSupplement(supplementDraft, period))}
            />
          ) : null}

          {kind === 'morning' ? (
            <label className="field">
              5:00-6:30 当天事项
              <textarea value={morningFocus} disabled={!writable} onChange={(event) => setMorningFocus(event.target.value)} />
            </label>
          ) : null}

          {kind === 'exercise' ? (
            <ExercisePanel
              draft={exerciseDraft}
              options={options.exercise}
              disabled={!writable}
              onChange={(patch) => setExerciseDraft((current) => ({ ...current, ...patch }))}
            />
          ) : null}

          {kind === 'task' ? (
            <>
              <label className="field">
                时间
                <input type="time" value={taskTime} onChange={(event) => setTaskTime(event.target.value)} />
              </label>
              <label className="field">
                事项名称
                <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} />
              </label>
              <label className="field">
                备注
                <input value={taskNote} onChange={(event) => setTaskNote(event.target.value)} />
              </label>
            </>
          ) : null}
        </>
      ) : null}
    </BottomSheet>
  )
}
