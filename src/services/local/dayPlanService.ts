import type {
  CustomTask,
  DailyExerciseItem,
  DailyMeal,
  DailyMealItem,
  DailySupplement,
  DayMode,
  DayPlan,
  MealType,
  PlanItemInput,
} from '../../shared/types/dayPlan'
import { MEAL_TYPES } from '../../shared/types/dayPlan'
import type { SupplementPeriod } from '../../shared/types/options'
import { SUPPLEMENT_PERIODS } from '../../shared/types/options'
import { addDays, defaultModeForDate, getBusinessDateKey } from '../../shared/date/dateUtils'
import { currentUser } from './authService'
import { getAll, newId, put, remove } from './localDb'
import { listSelectableOptions } from './optionService'

/**
 * 单日计划的读写。
 *
 * 内容与状态严格分离（docs/01 不变量 5 / 6）：
 * - 内容是「名称快照 + 时段/备注」，选项改名、停用、删除都不改写已有计划；
 * - 状态是各项 `completed` 与五个 `*_ready`，复制计划一律不带。
 */

function userId(): string {
  const user = currentUser()
  if (!user) throw new Error('请先登录。')
  return user.id
}

function now(): string {
  return new Date().toISOString()
}

function isHistory(planDate: string): boolean {
  return planDate < getBusinessDateKey()
}

function assertWritableDate(planDate: string): void {
  if (isHistory(planDate)) throw new Error('历史日期不可修改。')
}

function emptyPlan(planDate: string, uid: string): DayPlan {
  const timestamp = now()
  return {
    id: newId(),
    user_id: uid,
    plan_date: planDate,
    mode: defaultModeForDate(planDate),
    mode_override: false,
    created_at: timestamp,
    updated_at: timestamp,
    outfit_ready: false,
    meals_ready: false,
    supplements_ready: false,
    morning_ready: false,
    exercise_ready: false,
    morning_focus: '',
    morning_completed: false,
    exercise_decision: 'undecided',
    exercise_note: '',
    exercise_completed: false,
  }
}

/** 三餐按 breakfast → lunch → dinner 排序，不按字母序（字母序会把晚餐排到午餐前面）。 */
function mealIndex(type: MealType): number {
  return MEAL_TYPES.indexOf(type)
}

function periodIndex(period: SupplementPeriod): number {
  return SUPPLEMENT_PERIODS.indexOf(period)
}

function sortMeals(list: DailyMeal[]): DailyMeal[] {
  return [...list].sort((left, right) => mealIndex(left.meal_type) - mealIndex(right.meal_type))
}

function sortSupplements(list: DailySupplement[]): DailySupplement[] {
  return [...list].sort((left, right) => {
    if (left.period !== right.period) return periodIndex(left.period) - periodIndex(right.period)
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order
    return left.name_snapshot.localeCompare(right.name_snapshot, 'zh-Hans-CN')
  })
}

/**
 * 内容项统一按 `sort_order` 排，同序号时按名称稳定兜底。
 * 名称字段在三餐项里叫 `food_name_snapshot`、在健身项里叫 `name_snapshot`，
 * 所以由调用方传取值函数，不假定字段名。
 */
function sortByOrder<T extends { sort_order: number }>(list: T[], nameOf: (item: T) => string): T[] {
  return [...list].sort((left, right) =>
    left.sort_order !== right.sort_order
      ? left.sort_order - right.sort_order
      : nameOf(left).localeCompare(nameOf(right), 'zh-Hans-CN'),
  )
}

function sortItems<T extends { sort_order: number; name_snapshot: string }>(list: T[]): T[] {
  return sortByOrder(list, (item) => item.name_snapshot)
}

function sortMealItems(list: DailyMealItem[]): DailyMealItem[] {
  return sortByOrder(list, (item) => item.food_name_snapshot)
}

async function plansForUser(uid: string): Promise<DayPlan[]> {
  return (await getAll<DayPlan>('day_plans')).filter((plan) => plan.user_id === uid)
}

async function mealsForPlan(id: string): Promise<DailyMeal[]> {
  return (await getAll<DailyMeal>('daily_meals')).filter((meal) => meal.day_plan_id === id)
}

async function mealItemsFor(dailyMealIds: Set<string>): Promise<DailyMealItem[]> {
  return (await getAll<DailyMealItem>('daily_meal_items')).filter((item) => dailyMealIds.has(item.daily_meal_id))
}

async function supplementsForPlan(id: string): Promise<DailySupplement[]> {
  return sortSupplements((await getAll<DailySupplement>('daily_supplements')).filter((row) => row.day_plan_id === id))
}

async function exerciseItemsForPlan(id: string): Promise<DailyExerciseItem[]> {
  return sortItems((await getAll<DailyExerciseItem>('daily_exercise_items')).filter((row) => row.day_plan_id === id))
}

async function tasksForPlan(id: string): Promise<CustomTask[]> {
  return (await getAll<CustomTask>('custom_tasks')).filter((task) => task.day_plan_id === id)
}

async function dropMealItems(dailyMealIds: Set<string>): Promise<void> {
  for (const item of await mealItemsFor(dailyMealIds)) await remove('daily_meal_items', item.id)
}

/** 一餐的完整内容：面板提交什么，这一餐就是什么。 */
export type MealInput = { meal_type: MealType; note: string; items: PlanItemInput[] }
export type SupplementInput = {
  id: string | null
  name: string
  period: SupplementPeriod
  planned: boolean
  completed: boolean
}
export type ExerciseInput = {
  decision: DayPlan['exercise_decision']
  note: string
  items: PlanItemInput[]
}

export async function getDayPlan(planDate: string): Promise<DayPlan | null> {
  const uid = userId()
  return (await plansForUser(uid)).find((plan) => plan.plan_date === planDate) ?? null
}

export async function listDayPlans(planDates: string[]): Promise<DayPlan[]> {
  const wanted = new Set(planDates)
  return (await plansForUser(userId()))
    .filter((plan) => wanted.has(plan.plan_date))
    .sort((a, b) => a.plan_date.localeCompare(b.plan_date))
}

export async function upsertDayPlan(
  planDate: string,
  patch: Partial<DayPlan> & { mode?: DayMode; mode_override?: boolean } = {},
): Promise<DayPlan> {
  assertWritableDate(planDate)
  const uid = userId()
  const existing = (await plansForUser(uid)).find((plan) => plan.plan_date === planDate)
  const next: DayPlan = {
    ...(existing ?? emptyPlan(planDate, uid)),
    ...patch,
    id: existing?.id ?? newId(),
    user_id: uid,
    plan_date: planDate,
    updated_at: now(),
  }
  await put('day_plans', next)
  return next
}

export async function restoreDefaultDayPlan(planDate: string, defaultMode: DayMode): Promise<DayPlan> {
  return upsertDayPlan(planDate, { mode: defaultMode, mode_override: false })
}

// ---------------------------------------------------------------- 三餐

export async function listMeals(dayPlanId: string): Promise<DailyMeal[]> {
  return sortMeals(await mealsForPlan(dayPlanId))
}

/** 该天全部餐次的内容项。 */
export async function listMealItems(dayPlanId: string): Promise<DailyMealItem[]> {
  const meals = await mealsForPlan(dayPlanId)
  const items = await mealItemsFor(new Set(meals.map((meal) => meal.id)))
  return sortMealItems(items)
}

/**
 * 保存三餐。每餐的内容整体替换为面板提交的组合；`completed`（已吃）不在面板里，
 * 因此按已有记录原样保留，避免编辑内容顺手把执行状态清掉。
 */
export async function saveMeals(
  planDate: string,
  meals: MealInput[],
): Promise<{ meals: DailyMeal[]; items: DailyMealItem[] }> {
  assertWritableDate(planDate)
  const plan = (await getDayPlan(planDate)) ?? (await upsertDayPlan(planDate))
  const existingMeals = await mealsForPlan(plan.id)
  const timestamp = now()
  const savedMeals: DailyMeal[] = []
  const savedItems: DailyMealItem[] = []

  for (const input of meals) {
    const kept = existingMeals.find((meal) => meal.meal_type === input.meal_type)
    const meal: DailyMeal = {
      id: kept?.id ?? newId(),
      day_plan_id: plan.id,
      meal_type: input.meal_type,
      note: input.note,
      completed: kept?.completed ?? false,
    }
    await put('daily_meals', meal)
    savedMeals.push(meal)

    await dropMealItems(new Set([meal.id]))
    for (const [index, item] of input.items.entries()) {
      const record: DailyMealItem = {
        id: newId(),
        daily_meal_id: meal.id,
        food_option_id: item.optionId,
        food_name_snapshot: item.name,
        sort_order: index,
        created_at: timestamp,
      }
      await put('daily_meal_items', record)
      savedItems.push(record)
    }
  }

  return { meals: sortMeals(savedMeals), items: sortMealItems(savedItems) }
}

/**
 * 只改「这一餐吃没吃」，不碰内容项。
 *
 * 执行页的勾选会走这里而不是 `saveMeals`：后者按面板提交整体重建内容项，
 * 用它翻一个勾会把内容项的 id 与 created_at 全部重写一遍，是无谓的副作用。
 * 目标餐次还不存在时顺手建一条空记录，这样「没安排但确实吃了」也能勾上。
 */
export async function setMealCompleted(
  planDate: string,
  mealType: MealType,
  completed: boolean,
): Promise<DailyMeal[]> {
  assertWritableDate(planDate)
  const plan = (await getDayPlan(planDate)) ?? (await upsertDayPlan(planDate))
  const existing = (await mealsForPlan(plan.id)).find((meal) => meal.meal_type === mealType)

  await put<DailyMeal>('daily_meals', {
    id: existing?.id ?? newId(),
    day_plan_id: plan.id,
    meal_type: mealType,
    note: existing?.note ?? '',
    completed,
  })
  return sortMeals(await mealsForPlan(plan.id))
}

// ---------------------------------------------------------------- 补剂

/**
 * 取该天的补剂实例，并在需要时按当前启用模板补齐缺失项。
 *
 * 补齐规则（L2 定稿）：
 * - 只在写入日期发生（历史日期只读，不补）；
 * - 只补缺失，不删除、不改写已有实例——停用或改名模板不会动到这一天；
 * - 去重键是「时段 + 名称快照」，所以用户手工加的同名项不会被重复补。
 */
export async function ensureDaySupplements(planDate: string): Promise<DailySupplement[]> {
  const plan = await getDayPlan(planDate)
  if (!plan) return []
  const existing = await supplementsForPlan(plan.id)
  if (isHistory(planDate)) return existing

  const templates = await listSelectableOptions('supplement')
  const seen = new Set(existing.map((row) => `${row.period}:${row.name_snapshot}`))
  const timestamp = now()
  let nextOrder = existing.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1
  let changed = false

  for (const template of templates) {
    const key = `${template.period}:${template.name}`
    if (seen.has(key)) continue
    seen.add(key)
    await put<DailySupplement>('daily_supplements', {
      id: newId(),
      day_plan_id: plan.id,
      name_snapshot: template.name,
      period: template.period,
      planned: true,
      completed: false,
      sort_order: nextOrder,
      created_at: timestamp,
      updated_at: timestamp,
    })
    nextOrder += 1
    changed = true
  }

  return changed ? supplementsForPlan(plan.id) : existing
}

export async function listDaySupplements(dayPlanId: string): Promise<DailySupplement[]> {
  return supplementsForPlan(dayPlanId)
}

/**
 * 保存该天的补剂实例：面板提交的就是这一天的完整清单。
 * `planned` 是内容（复制计划会带走），`completed` 是执行状态（复制计划不带）。
 *
 * 入库前先做一次清洗：去掉空名称、按「时段 + 名称」去重。
 * 这与 `ensureDaySupplements` 的去重键是同一个，否则用户存下重复项后，
 * 补齐逻辑下次又会认定「缺一条」而反复追加。
 */
export async function saveDaySupplements(planDate: string, rows: SupplementInput[]): Promise<DailySupplement[]> {
  assertWritableDate(planDate)
  const plan = (await getDayPlan(planDate)) ?? (await upsertDayPlan(planDate))
  const existing = await supplementsForPlan(plan.id)
  const timestamp = now()
  const saved: DailySupplement[] = []
  const keptIds = new Set<string>()
  const seenKeys = new Set<string>()

  const cleaned = rows
    .map((row) => ({ ...row, name: row.name.trim() }))
    .filter((row) => {
      if (!row.name) return false
      const key = `${row.period}:${row.name}`
      if (seenKeys.has(key)) return false
      seenKeys.add(key)
      return true
    })

  for (const [index, row] of cleaned.entries()) {
    const kept = row.id ? existing.find((item) => item.id === row.id) : undefined
    const record: DailySupplement = {
      id: kept?.id ?? newId(),
      day_plan_id: plan.id,
      name_snapshot: row.name,
      period: row.period,
      planned: row.planned,
      completed: row.completed,
      sort_order: index,
      created_at: kept?.created_at ?? timestamp,
      updated_at: timestamp,
    }
    await put('daily_supplements', record)
    saved.push(record)
    keptIds.add(record.id)
  }

  for (const row of existing) {
    if (!keptIds.has(row.id)) await remove('daily_supplements', row.id)
  }

  return sortSupplements(saved)
}

/** 只翻某一条补剂的「今天吃没吃」，内容与顺序都不动。 */
export async function setSupplementCompleted(
  planDate: string,
  id: string,
  completed: boolean,
): Promise<DailySupplement[]> {
  assertWritableDate(planDate)
  const plan = await getDayPlan(planDate)
  if (!plan) return []

  const row = (await supplementsForPlan(plan.id)).find((item) => item.id === id)
  if (row) await put<DailySupplement>('daily_supplements', { ...row, completed, updated_at: now() })
  return supplementsForPlan(plan.id)
}

// ---------------------------------------------------------------- 健身

export async function listExerciseItems(dayPlanId: string): Promise<DailyExerciseItem[]> {
  return exerciseItemsForPlan(dayPlanId)
}

/**
 * 保存健身安排。决定与备注写进计划主记录，项目多选写进 `daily_exercise_items`。
 * 选择「不健身」时**不清空**已选项目：它们是内容，切回健身时能原样恢复，
 * 执行页也只在决定为「健身」时才展示。
 */
export async function saveExercise(
  planDate: string,
  input: ExerciseInput,
): Promise<{ plan: DayPlan; items: DailyExerciseItem[] }> {
  assertWritableDate(planDate)
  const plan = (await getDayPlan(planDate)) ?? (await upsertDayPlan(planDate))
  const next = await upsertDayPlan(planDate, {
    exercise_decision: input.decision,
    exercise_note: input.note,
  })

  for (const row of await exerciseItemsForPlan(plan.id)) await remove('daily_exercise_items', row.id)

  const timestamp = now()
  const items: DailyExerciseItem[] = []
  for (const [index, item] of input.items.entries()) {
    const record: DailyExerciseItem = {
      id: newId(),
      day_plan_id: next.id,
      exercise_option_id: item.optionId,
      name_snapshot: item.name,
      sort_order: index,
      created_at: timestamp,
    }
    await put('daily_exercise_items', record)
    items.push(record)
  }

  return { plan: next, items: sortItems(items) }
}

// ---------------------------------------------------------------- 自定义事项

export async function listCustomTasks(dayPlanId: string): Promise<CustomTask[]> {
  return (await tasksForPlan(dayPlanId)).sort((a, b) => a.task_time.localeCompare(b.task_time))
}

export async function saveCustomTask(
  planDate: string,
  task: Partial<CustomTask> & { task_time: string; title: string; note: string; completed: boolean },
): Promise<CustomTask> {
  assertWritableDate(planDate)
  const plan = (await getDayPlan(planDate)) ?? (await upsertDayPlan(planDate))
  const next: CustomTask = {
    id: task.id ?? newId(),
    day_plan_id: plan.id,
    task_time: task.task_time,
    title: task.title,
    note: task.note,
    completed: task.completed,
  }
  await put('custom_tasks', next)
  return next
}

export async function deleteCustomTask(planDate: string, id: string): Promise<void> {
  assertWritableDate(planDate)
  const plan = await getDayPlan(planDate)
  if (!plan) return
  const task = (await tasksForPlan(plan.id)).find((item) => item.id === id)
  if (task) await remove('custom_tasks', id)
}

// ---------------------------------------------------------------- 复制

/**
 * 复制昨天：只带走内容与名称快照，绝不带走执行状态。
 *
 * 带走：晨间内容、健身决定、三餐内容与备注、补剂实例（名称 / 时段 / 是否计划）、
 *       健身项目、自定义事项。
 * 不带：五个准备勾选、三餐完成、补剂完成、晨间完成、健身完成，以及目标日自己的
 *       模式与 `mode_override`（复制不改变这一天是工作日还是休息日）。
 */
export async function copyYesterday(planDate: string): Promise<DayPlan> {
  assertWritableDate(planDate)
  const uid = userId()
  const source = (await plansForUser(uid)).find((plan) => plan.plan_date === addDays(planDate, -1))
  if (!source) throw new Error('昨天没有可复制的计划。')

  const existingTarget = (await plansForUser(uid)).find((plan) => plan.plan_date === planDate)
  const target: DayPlan = {
    ...(existingTarget ?? emptyPlan(planDate, uid)),
    id: existingTarget?.id ?? newId(),
    user_id: uid,
    plan_date: planDate,
    morning_focus: source.morning_focus,
    exercise_decision: source.exercise_decision,
    exercise_note: source.exercise_note,
    outfit_ready: false,
    meals_ready: false,
    supplements_ready: false,
    morning_ready: false,
    exercise_ready: false,
    morning_completed: false,
    exercise_completed: false,
    updated_at: now(),
  }
  await put('day_plans', target)

  // 三餐：先清空目标日，再按来源日重建（含每餐的内容项）
  const sourceMeals = await mealsForPlan(source.id)
  const targetMeals = await mealsForPlan(target.id)
  await dropMealItems(new Set(targetMeals.map((meal) => meal.id)))
  for (const meal of targetMeals) await remove('daily_meals', meal.id)

  const sourceItems = await mealItemsFor(new Set(sourceMeals.map((meal) => meal.id)))
  for (const meal of sourceMeals) {
    const copiedMeal: DailyMeal = {
      id: newId(),
      day_plan_id: target.id,
      meal_type: meal.meal_type,
      note: meal.note,
      completed: false,
    }
    await put('daily_meals', copiedMeal)
    for (const item of sourceItems.filter((row) => row.daily_meal_id === meal.id)) {
      await put<DailyMealItem>('daily_meal_items', { ...item, id: newId(), daily_meal_id: copiedMeal.id })
    }
  }

  // 补剂：内容照抄（含 planned），完成状态归零
  const timestamp = now()
  for (const row of await supplementsForPlan(target.id)) await remove('daily_supplements', row.id)
  for (const row of await supplementsForPlan(source.id)) {
    await put<DailySupplement>('daily_supplements', {
      ...row,
      id: newId(),
      day_plan_id: target.id,
      completed: false,
      updated_at: timestamp,
    })
  }

  // 健身项：内容照抄
  for (const row of await exerciseItemsForPlan(target.id)) await remove('daily_exercise_items', row.id)
  for (const row of await exerciseItemsForPlan(source.id)) {
    await put<DailyExerciseItem>('daily_exercise_items', { ...row, id: newId(), day_plan_id: target.id })
  }

  // 自定义事项：内容照抄，完成状态归零
  for (const task of await tasksForPlan(target.id)) await remove('custom_tasks', task.id)
  for (const task of await tasksForPlan(source.id)) {
    await put<CustomTask>('custom_tasks', { ...task, id: newId(), day_plan_id: target.id, completed: false })
  }

  return target
}
