import { useState } from 'react'
import type { CustomTask, DailyMeal, DayPlan, MealType } from '../../../shared/types/dayPlan'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { MEAL_NAMES, MEAL_TYPES } from '../dayPlanLabels'
import type { PrepEditor } from './PrepList'

export type EditorKind = PrepEditor | 'task'

type MealDraft = Record<MealType, { plan_content: string; note: string }>

const PANEL_TITLE: Record<EditorKind, string> = {
  meals: '编辑三餐',
  morning: '编辑晨间事项',
  exercise: '编辑健身安排',
  task: '编辑事项',
}

function buildMealDraft(meals: DailyMeal[]): MealDraft {
  const draft = {} as MealDraft
  for (const type of MEAL_TYPES) {
    const existing = meals.find((meal) => meal.meal_type === type)
    draft[type] = { plan_content: existing?.plan_content ?? '', note: existing?.note ?? '' }
  }
  return draft
}

/**
 * 底部编辑面板。四种编辑对象共用一套草稿状态，保存时统一产出 payload，
 * 由调用方按 kind 落到对应服务；面板本身不碰数据层。
 */
export function EditorSheet({
  kind,
  meals,
  plan,
  task,
  onCancel,
  onSave,
}: {
  kind: EditorKind
  meals: DailyMeal[]
  plan: DayPlan | null
  task: CustomTask | null
  onCancel: () => void
  onSave: (payload: Record<string, unknown>) => void
}) {
  const [mealDraft, setMealDraft] = useState<MealDraft>(() => buildMealDraft(meals))
  const [morningFocus, setMorningFocus] = useState(plan?.morning_focus ?? '')
  const [decision, setDecision] = useState<DayPlan['exercise_decision']>(plan?.exercise_decision ?? 'undecided')
  const [exerciseContent, setExerciseContent] = useState(plan?.exercise_content ?? '')
  const [exerciseNote, setExerciseNote] = useState(plan?.exercise_note ?? '')
  const [taskTime, setTaskTime] = useState(task?.task_time?.slice(0, 5) || '08:00')
  const [taskTitle, setTaskTitle] = useState(task?.title ?? '')
  const [taskNote, setTaskNote] = useState(task?.note ?? '')

  function updateMeal(type: MealType, patch: Partial<MealDraft[MealType]>) {
    setMealDraft((current) => ({ ...current, [type]: { ...current[type], ...patch } }))
  }

  function buildPayload(): Record<string, unknown> {
    if (kind === 'meals') {
      return {
        meals: MEAL_TYPES.map((type) => ({
          meal_type: type,
          plan_content: mealDraft[type].plan_content,
          note: mealDraft[type].note,
          completed: meals.find((meal) => meal.meal_type === type)?.completed ?? false,
        })),
      }
    }
    if (kind === 'morning') return { morning_focus: morningFocus }
    if (kind === 'exercise') {
      return { exercise_decision: decision, exercise_content: exerciseContent, exercise_note: exerciseNote }
    }
    return { task_time: taskTime, title: taskTitle, note: taskNote }
  }

  const title = kind === 'task' && !task ? '添加事项' : PANEL_TITLE[kind]

  return (
    <BottomSheet title={title} onSave={() => onSave(buildPayload())} onCancel={onCancel}>
      {kind === 'meals'
        ? MEAL_TYPES.map((type) => (
            <div className="field" key={type}>
              <label>
                {MEAL_NAMES[type]}计划
                <input
                  value={mealDraft[type].plan_content}
                  onChange={(event) => updateMeal(type, { plan_content: event.target.value })}
                />
              </label>
              <label>
                {MEAL_NAMES[type]}备注
                <input value={mealDraft[type].note} onChange={(event) => updateMeal(type, { note: event.target.value })} />
              </label>
            </div>
          ))
        : null}

      {kind === 'morning' ? (
        <label className="field">
          5:00-6:30 当天事项
          <textarea value={morningFocus} onChange={(event) => setMorningFocus(event.target.value)} />
        </label>
      ) : null}

      {kind === 'exercise' ? (
        <>
          <label className="field">
            安排
            <select
              value={decision}
              onChange={(event) => setDecision(event.target.value as DayPlan['exercise_decision'])}
            >
              <option value="undecided">未决定</option>
              <option value="exercise">健身</option>
              <option value="rest">不健身</option>
            </select>
          </label>
          {decision === 'exercise' ? (
            <>
              <label className="field">
                具体内容
                <input value={exerciseContent} onChange={(event) => setExerciseContent(event.target.value)} />
              </label>
              <label className="field">
                备注
                <input value={exerciseNote} onChange={(event) => setExerciseNote(event.target.value)} />
              </label>
            </>
          ) : null}
        </>
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
    </BottomSheet>
  )
}
