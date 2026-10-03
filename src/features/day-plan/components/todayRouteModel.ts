import type {
  CustomTask,
  DailyExerciseItem,
  DailyMeal,
  DailyMealItem,
  DailySupplement,
  DayMode,
  DayPlan,
  RoutineTask,
} from '../../../shared/types/dayPlan'
import { MEAL_TYPES, ROUTINE_ORDER } from '../../../shared/types/dayPlan'
import type { DateRelation } from '../../../shared/date/dateUtils'
import { SUPPLEMENT_PERIODS } from '../../../shared/types/options'
import { SUPPLEMENT_PERIOD_LABEL } from '../../../shared/periodLabels'
import { getExecuteActionItems, getPrepActionItems } from './actionItems'
import type { NextActionItem } from './NextAction'
import type { PrepKey } from './PrepList'
import type { ExecutionToggle } from './ExecuteList'
import type { EditorKind } from './EditorSheet'
import { MEAL_NAMES } from '../dayPlanLabels'

export type TodayNodeState = 'unprepared' | 'current' | 'upcoming' | 'completed' | 'readonly'
export type TodayNodeKind = 'morning' | 'meal' | 'supplement' | 'exercise' | 'routine' | 'custom-task' | 'prep'
export type MollyFireState = 'quiet' | 'glow' | 'bright' | 'settled'
export type TodayCompletionTarget =
  | { kind: 'prep'; key: PrepKey }
  | { kind: 'execution'; toggle: ExecutionToggle }
  | { kind: 'routine'; id: string }
  | { kind: 'task'; id: string }

export type TodayRouteNode = {
  id: string
  kind: TodayNodeKind
  title: string
  detail?: string
  state: TodayNodeState
  completed: boolean
  editable: boolean
  completionTarget?: TodayCompletionTarget
  editorTarget?: EditorKind
  task?: CustomTask
  routineKind?: RoutineTask['kind']
  nextAction: NextActionItem
}

export type TodayRoute = {
  nodes: TodayRouteNode[]
  focus: TodayRouteNode | null
  readonly: boolean
  molly: MollyFireState | null
}

type BuildTodayRouteInput = {
  relation: DateRelation
  prepare: boolean
  mode: DayMode
  plan: DayPlan | null
  meals: DailyMeal[]
  mealItems: DailyMealItem[]
  supplements: DailySupplement[]
  exerciseItems: DailyExerciseItem[]
  routines: RoutineTask[]
  tasks: CustomTask[]
}

const PREP_EDITORS: Partial<Record<PrepKey, EditorKind>> = {
  meals_ready: 'meals',
  supplements_ready: 'supplements',
  morning_ready: 'morning',
  exercise_ready: 'exercise',
}

function node(
  input: Omit<TodayRouteNode, 'state' | 'nextAction'> & { action?: NextActionItem; unprepared?: boolean },
): TodayRouteNode {
  return {
    ...input,
    state: input.completed ? 'completed' : input.unprepared ? 'unprepared' : 'upcoming',
    nextAction: input.action ?? {
      id: input.id,
      label: input.title,
      detail: input.detail,
      completed: input.completed,
    },
  }
}

function hasMealPlan(meal: DailyMeal | undefined, items: DailyMealItem[]): boolean {
  return Boolean(meal && (items.length > 0 || meal.note.trim()))
}

function buildExecutionNodes(input: BuildTodayRouteInput): TodayRouteNode[] {
  const { mode, plan, meals, mealItems, supplements, exerciseItems, routines, tasks } = input
  const hasAnyPlan = Boolean(
    plan || meals.length || supplements.length || exerciseItems.length || routines.length || tasks.length,
  )
  // 今天即使尚未创建 DayPlan，也要投影完整的执行事项；用户需要先看到并安排它们。
  // 只有历史日期和未来/明天空白日期保持空白，避免误造历史或未来执行数据。
  if (input.relation === 'history' && !hasAnyPlan) return []
  if ((input.relation === 'future' || input.relation === 'tomorrow') && !hasAnyPlan) return []

  const actions = getExecuteActionItems({
    plan,
    meals,
    mealItems,
    supplements,
    exerciseItems,
    mode,
  })
  const actionById = new Map(actions.map((item) => [item.id, item]))
  const nodes: TodayRouteNode[] = []
  const plannedSupplements = supplements
    .filter((item) => item.planned)
    .sort((a, b) =>
      SUPPLEMENT_PERIODS.indexOf(a.period) - SUPPLEMENT_PERIODS.indexOf(b.period) ||
      a.sort_order - b.sort_order,
    )
  const appendSupplements = (period: (typeof SUPPLEMENT_PERIODS)[number]) => {
    for (const row of plannedSupplements.filter((item) => item.period === period)) {
      const id = `supplement-${row.id}`
      nodes.push(node({
        id,
        kind: 'supplement',
        title: `${SUPPLEMENT_PERIOD_LABEL[period]} · ${row.name_snapshot}`,
        completed: row.completed,
        editable: true,
        completionTarget: { kind: 'execution', toggle: { kind: 'supplement', id: row.id } },
        editorTarget: 'supplements',
        action: actionById.get(id),
      }))
    }
  }
  const appendExercise = () => {
    if (plan?.exercise_decision === 'exercise') {
      const action = actionById.get('exercise')
      nodes.push(node({
        id: 'exercise',
        kind: 'exercise',
        title: '健身',
        detail: action?.detail,
        completed: Boolean(plan.exercise_completed),
        editable: true,
        completionTarget: { kind: 'execution', toggle: { kind: 'exercise' } },
        editorTarget: 'exercise',
        action,
      }))
    } else if (plan?.exercise_decision !== 'rest') {
      nodes.push(node({
        id: 'exercise-unprepared',
        kind: 'exercise',
        title: '健身安排尚未决定',
        detail: '可以安排健身，也可以选择不健身',
        completed: false,
        editable: true,
        editorTarget: 'exercise',
        unprepared: true,
      }))
    } else {
      nodes.push(node({
        id: 'exercise-rest',
        kind: 'exercise',
        title: '今天不健身',
        completed: false,
        editable: true,
        editorTarget: 'exercise',
      }))
    }
  }
  const appendSupplementAnchor = () => {
    if (plannedSupplements.length) return
    nodes.push(node({
      id: 'supplement-unprepared',
      kind: 'supplement',
      title: '补剂尚未安排',
      detail: '可按早、中、晚安排',
      completed: false,
      editable: true,
      editorTarget: 'supplements',
      unprepared: true,
    }))
  }

  if (mode === 'rest') {
    for (const routine of [...(plan?.mode_override ? [] : routines)].sort((a, b) =>
      ROUTINE_ORDER.indexOf(a.kind) - ROUTINE_ORDER.indexOf(b.kind),
    )) {
      nodes.push(node({
        id: `routine-${routine.id}`,
        kind: 'routine',
        title: routine.title,
        completed: routine.completed,
        editable: false,
        completionTarget: { kind: 'routine', id: routine.id },
        routineKind: routine.kind,
      }))
    }
    appendSupplements('morning')
    appendSupplementAnchor()
    appendSupplements('noon')
    appendExercise()
    appendSupplements('evening')
  } else {
    const action = actionById.get('morning')
    const arranged = Boolean(plan?.morning_focus.trim())
    nodes.push(node({
      id: 'morning',
      kind: 'morning',
      title: action?.label ?? '晨间事项',
      detail: action?.detail ?? '5:00-6:30 · 尚未安排',
      completed: arranged && Boolean(plan?.morning_completed),
      editable: true,
      editorTarget: 'morning',
      ...(arranged
        ? { completionTarget: { kind: 'execution', toggle: { kind: 'morning' } } as const }
        : { unprepared: true }),
      action,
    }))

    const appendMeal = (mealType: (typeof MEAL_TYPES)[number]) => {
      const meal = meals.find((item) => item.meal_type === mealType)
      const mealContent = mealItems.filter((item) => item.daily_meal_id === meal?.id)
      const arranged = hasMealPlan(meal, mealContent)
      const id = `meal-${mealType}`
      const action = actionById.get(id)
      const label = MEAL_NAMES[mealType]
      const mealDetail = mealContent.map((item) => item.food_name_snapshot).join('、')
      const toggle = { kind: 'meal', mealType } as const
      nodes.push(node({
        id,
        kind: 'meal',
        title: label,
        detail: arranged ? (action?.detail ?? mealDetail) : '尚未安排',
        completed: arranged && Boolean(meal?.completed),
        editable: true,
        editorTarget: 'meals',
        ...(arranged
          ? { completionTarget: { kind: 'execution', toggle } as const }
          : { unprepared: true }),
        action,
      }))
    }
    appendMeal('breakfast')
    appendSupplements('morning')
    appendSupplementAnchor()
    appendMeal('lunch')
    appendSupplements('noon')
    appendExercise()
    appendMeal('dinner')
    appendSupplements('evening')
  }

  return nodes
}

function taskNodes(tasks: CustomTask[]): TodayRouteNode[] {
  return [...tasks].sort((a, b) => a.task_time.localeCompare(b.task_time)).map((task) => node({
    id: `task-${task.id}`,
    kind: 'custom-task',
    title: `${task.task_time.slice(0, 5)} · ${task.title}`,
    detail: task.note || undefined,
    completed: task.completed,
    editable: true,
    completionTarget: { kind: 'task', id: task.id },
    editorTarget: 'task',
    task,
  }))
}

function buildEmptyTodayTemplate(): TodayRouteNode[] {
  return [
    node({ id: 'morning', kind: 'morning', title: '晨间事项', detail: '尚未安排', completed: false, editable: true, editorTarget: 'morning', unprepared: true }),
    node({ id: 'meal-breakfast', kind: 'meal', title: MEAL_NAMES.breakfast, detail: '尚未安排', completed: false, editable: true, editorTarget: 'meals', unprepared: true }),
    node({ id: 'supplement-morning', kind: 'supplement', title: '早间补剂', detail: '尚未安排', completed: false, editable: true, editorTarget: 'supplements', unprepared: true }),
    node({ id: 'meal-lunch', kind: 'meal', title: MEAL_NAMES.lunch, detail: '尚未安排', completed: false, editable: true, editorTarget: 'meals', unprepared: true }),
    node({ id: 'supplement-noon', kind: 'supplement', title: '午间补剂', detail: '尚未安排', completed: false, editable: true, editorTarget: 'supplements', unprepared: true }),
    node({ id: 'exercise-unprepared', kind: 'exercise', title: '健身', detail: '尚未安排', completed: false, editable: true, editorTarget: 'exercise', unprepared: true }),
    node({ id: 'meal-dinner', kind: 'meal', title: MEAL_NAMES.dinner, detail: '尚未安排', completed: false, editable: true, editorTarget: 'meals', unprepared: true }),
    node({ id: 'supplement-evening', kind: 'supplement', title: '晚间补剂', detail: '尚未安排', completed: false, editable: true, editorTarget: 'supplements', unprepared: true }),
  ]
}

function applyStates(nodes: TodayRouteNode[], readonly: boolean, prepare: boolean): { nodes: TodayRouteNode[]; focus: TodayRouteNode | null } {
  const focusable = prepare ? nodes.filter((item) => item.kind === 'prep') : nodes
  const focus = readonly ? null : focusable.find((item) => item.state === 'unprepared') ??
    focusable.find((item) => !item.completed && item.completionTarget)
  const focusedId = focus?.id
  const resolved = nodes.map((item) => ({
    ...item,
    state: (readonly
      ? 'readonly'
      : item.completed
        ? 'completed'
        : item.id === focusedId && item.completionTarget
          ? 'current'
          : item.state === 'unprepared'
            ? 'unprepared'
            : 'upcoming') as TodayNodeState,
  }))
  return {
    nodes: resolved,
    focus: resolved.find((item) => item.id === focusedId) ?? null,
  }
}

function deriveMollyFire(nodes: TodayRouteNode[]): MollyFireState {
  const executable = nodes.filter((item) => item.completionTarget && item.state !== 'unprepared' && item.state !== 'readonly')
  if (executable.length === 0) return 'quiet'

  const completed = executable.filter((item) => item.completed).length
  if (completed === 0) return 'quiet'
  if (completed === executable.length) return 'settled'
  if (completed * 2 >= executable.length) return 'bright'
  return 'glow'
}

export function buildTodayRoute(input: BuildTodayRouteInput): TodayRoute {
  const readonly = input.relation === 'history'
  let nodes: TodayRouteNode[]
  if (input.prepare && input.mode === 'work') {
    nodes = getPrepActionItems({
      plan: input.plan,
      meals: input.meals,
      mealItems: input.mealItems,
      supplements: input.supplements,
    }).map((action) => {
      const key = action.id as PrepKey
      const completed = Boolean(input.plan?.[key])
      return node({
        id: action.id,
        kind: 'prep',
        title: action.label,
        detail: action.detail,
        completed,
        editable: Boolean(PREP_EDITORS[key]),
        completionTarget: { kind: 'prep', key },
        editorTarget: PREP_EDITORS[key],
        action,
      })
    })
  } else {
    nodes = buildExecutionNodes(input)
  }
  const hasConfiguredExecution = Boolean(
    input.plan?.morning_focus.trim()
      || input.plan?.exercise_decision
      || input.mealItems.length
      || input.meals.some((meal) => meal.note.trim())
      || input.supplements.some((supplement) => supplement.planned)
      || input.tasks.length
  )
  if (input.relation === 'today' && !input.prepare && input.mode === 'work' && !hasConfiguredExecution) {
    nodes = buildEmptyTodayTemplate()
  }
  nodes.push(...taskNodes(input.tasks))
  const resolved = applyStates(nodes, readonly, input.prepare && input.mode === 'work')
  return {
    nodes: resolved.nodes,
    focus: resolved.focus,
    readonly,
    molly: input.relation === 'today' && !input.prepare ? deriveMollyFire(resolved.nodes) : null,
  }
}



