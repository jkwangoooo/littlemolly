import type {
  CustomTask,
  DailyExerciseItem,
  DailyMeal,
  DailyMealItem,
  DailySupplement,
  DayMode,
  DayPlan,
  ExerciseInput,
  MealInput,
  MealType,
  RoutineTask,
  SupplementInput,
} from '../../shared/types/dayPlan'
import { MEAL_TYPES, ROUTINE_ORDER, ROUTINE_TITLES } from '../../shared/types/dayPlan'
import type { SupplementPeriod } from '../../shared/types/options'
import { SUPPLEMENT_PERIODS } from '../../shared/types/options'
import { defaultModeForDate, getBusinessDateKey } from '../../shared/date/dateUtils'
import { throwSupabaseError } from './errors'
import { listSelectableOptions } from './optionService'
import { requireSupabase } from './supabase'

/**
 * 单日计划的读写（Supabase 后端，L6）。
 *
 * **这个文件必须与 `local/dayPlanService.ts` 行为等价**，判据是两件事：
 *
 * 1. 导出的函数名与签名逐个对齐——`cloud/parity.ts` 里用类型断言强制，
 *    以后本地加了一个函数而云端漏了，`tsc` 会直接报错；
 * 2. 目录里写下的每条规则都照搬：内容与状态分离、历史日期只读、
 *    「名称快照优先」、复制昨天不带执行状态与家务（docs/01 不变量 5 / 6 / 7）。
 *
 * 与本地实现的三处**有意差异**，都不是行为差异：
 * - 主键由数据库 `gen_random_uuid()` 生成，不再客户端造 id，靠 `select` 读回；
 * - 归属由 RLS 与列的 `default auth.uid()` 决定，因此查询不再自带 `user_id` 过滤；
 * - 多表写入无法像本地 IndexedDB 那样放进单个事务，跨表原子性由
 *   服务端 RPC（`copy_yesterday_stage4`）承担，其余路径靠「先删后写、失败可见」兜底。
 */

export type { ExerciseInput, MealInput, SupplementInput }

const PLAN_COLUMNS =
  'id,user_id,plan_date,mode,mode_override,created_at,updated_at,outfit_ready,meals_ready,supplements_ready,morning_ready,exercise_ready,morning_focus,morning_completed,exercise_decision,exercise_note,exercise_completed'
const MEAL_COLUMNS = 'id,day_plan_id,meal_type,note,completed'
const MEAL_ITEM_COLUMNS = 'id,daily_meal_id,food_option_id,food_name_snapshot,sort_order,created_at'
const SUPPLEMENT_COLUMNS = 'id,day_plan_id,name_snapshot,period,planned,completed,sort_order,created_at,updated_at'
const EXERCISE_ITEM_COLUMNS = 'id,day_plan_id,exercise_option_id,name_snapshot,sort_order,created_at'
const TASK_COLUMNS = 'id,day_plan_id,task_time,title,note,completed'
const ROUTINE_COLUMNS = 'id,day_plan_id,kind,title,completed'

/** 计划主记录里允许被写库的字段；`id` / `user_id` / 时间戳不接受外部指定。 */
const PLAN_PATCH_FIELDS = [
  'mode',
  'mode_override',
  'outfit_ready',
  'meals_ready',
  'supplements_ready',
  'morning_ready',
  'exercise_ready',
  'morning_focus',
  'morning_completed',
  'exercise_decision',
  'exercise_note',
  'exercise_completed',
] as const

function client() {
  return requireSupabase()
}

function isHistory(planDate: string): boolean {
  return planDate < getBusinessDateKey()
}

function assertWritableDate(planDate: string): void {
  if (isHistory(planDate)) throw new Error('历史日期不可修改。')
}

/** 可写字段的形状：主记录的「内容 + 状态」，不含主键、归属与时间戳。 */
type PlanContent = Omit<DayPlan, 'id' | 'user_id' | 'created_at' | 'updated_at'>

/** 与本地 `emptyPlan` 同义：这一天还没有任何内容时的默认值。 */
function emptyContent(planDate: string): PlanContent {
  return {
    plan_date: planDate,
    mode: defaultModeForDate(planDate),
    mode_override: false,
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

/**
 * 从已有记录里取出可写字段。
 * 逐字段手写而不是循环拷贝：字段名与类型一一对上，少写一个字段会当场编译不过，
 * 循环 + 断言则会把漏字段变成静默的数据丢失（把已有准备勾选重置成 false）。
 */
function writablePlan(plan: DayPlan): PlanContent {
  return {
    plan_date: plan.plan_date,
    mode: plan.mode,
    mode_override: plan.mode_override,
    outfit_ready: plan.outfit_ready,
    meals_ready: plan.meals_ready,
    supplements_ready: plan.supplements_ready,
    morning_ready: plan.morning_ready,
    exercise_ready: plan.exercise_ready,
    morning_focus: plan.morning_focus,
    morning_completed: plan.morning_completed,
    exercise_decision: plan.exercise_decision,
    exercise_note: plan.exercise_note,
    exercise_completed: plan.exercise_completed,
  }
}

/** 只把 patch 里属于可写字段的部分抄出来，避免把 id 之类的字段写回去。 */
function pluckPatch(patch: Partial<DayPlan>): Partial<PlanContent> {
  const picked: Partial<PlanContent> = {}
  for (const key of PLAN_PATCH_FIELDS) {
    if (patch[key] !== undefined) picked[key] = patch[key] as never
  }
  return picked
}

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

/** 内容项统一按 `sort_order` 排，同序号时按名称稳定兜底（名称字段三处叫法不同，由调用方给）。 */
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

function sortRoutines(list: RoutineTask[]): RoutineTask[] {
  return [...list].sort((left, right) => ROUTINE_ORDER.indexOf(left.kind) - ROUTINE_ORDER.indexOf(right.kind))
}

// ---------------------------------------------------------------- 计划主记录

export async function getDayPlan(planDate: string): Promise<DayPlan | null> {
  const { data, error } = await client()
    .from('day_plans')
    .select(PLAN_COLUMNS)
    .eq('plan_date', planDate)
    .maybeSingle()
  if (error) throwSupabaseError(error)
  return (data as DayPlan | null) ?? null
}

export async function listDayPlans(planDates: string[]): Promise<DayPlan[]> {
  if (!planDates.length) return []
  const { data, error } = await client()
    .from('day_plans')
    .select(PLAN_COLUMNS)
    .in('plan_date', planDates)
    .order('plan_date')
  if (error) throwSupabaseError(error)
  return (data ?? []) as DayPlan[]
}

export async function upsertDayPlan(
  planDate: string,
  patch: Partial<DayPlan> & { mode?: DayMode; mode_override?: boolean } = {},
): Promise<DayPlan> {
  assertWritableDate(planDate)
  const existing = await getDayPlan(planDate)
  const content = existing ? writablePlan(existing) : emptyContent(planDate)
  const payload = { ...content, ...pluckPatch(patch), plan_date: planDate }

  const { data, error } = await client()
    .from('day_plans')
    .upsert(payload, { onConflict: 'user_id,plan_date' })
    .select(PLAN_COLUMNS)
    .single()
  if (error) throwSupabaseError(error)
  return data as DayPlan
}

export async function restoreDefaultDayPlan(planDate: string, defaultMode: DayMode): Promise<DayPlan> {
  return upsertDayPlan(planDate, { mode: defaultMode, mode_override: false })
}

/** 目标日还不存在主记录时先建一条，后续所有写入都以它的 id 为父键。 */
async function ensurePlan(planDate: string): Promise<DayPlan> {
  return (await getDayPlan(planDate)) ?? (await upsertDayPlan(planDate))
}

// ---------------------------------------------------------------- 三餐

export async function listMeals(dayPlanId: string): Promise<DailyMeal[]> {
  const { data, error } = await client().from('daily_meals').select(MEAL_COLUMNS).eq('day_plan_id', dayPlanId)
  if (error) throwSupabaseError(error)
  return sortMeals((data ?? []) as DailyMeal[])
}

/** 该天全部餐次的内容项。子表只存 `daily_meal_id`，所以先取餐次拿父键。 */
export async function listMealItems(dayPlanId: string): Promise<DailyMealItem[]> {
  const meals = await listMeals(dayPlanId)
  if (!meals.length) return []
  const { data, error } = await client()
    .from('daily_meal_items')
    .select(MEAL_ITEM_COLUMNS)
    .in('daily_meal_id', meals.map((meal) => meal.id))
  if (error) throwSupabaseError(error)
  return sortMealItems((data ?? []) as DailyMealItem[])
}

async function deleteMealItems(dailyMealIds: string[]): Promise<void> {
  if (!dailyMealIds.length) return
  const { error } = await client().from('daily_meal_items').delete().in('daily_meal_id', dailyMealIds)
  if (error) throwSupabaseError(error)
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
  const plan = await ensurePlan(planDate)
  const existingMeals = await listMeals(plan.id)
  const savedMeals: DailyMeal[] = []
  const savedItems: DailyMealItem[] = []

  for (const input of meals) {
    const kept = existingMeals.find((meal) => meal.meal_type === input.meal_type)
    const { data, error } = await client()
      .from('daily_meals')
      .upsert(
        {
          day_plan_id: plan.id,
          meal_type: input.meal_type,
          note: input.note,
          completed: kept?.completed ?? false,
        },
        { onConflict: 'day_plan_id,meal_type' },
      )
      .select(MEAL_COLUMNS)
      .single()
    if (error) throwSupabaseError(error)
    const meal = data as DailyMeal
    savedMeals.push(meal)

    await deleteMealItems([meal.id])
    if (input.items.length) {
      const rows = input.items.map((item, index) => ({
        daily_meal_id: meal.id,
        food_option_id: item.optionId,
        food_name_snapshot: item.name,
        sort_order: index,
      }))
      const { data: itemData, error: itemError } = await client()
        .from('daily_meal_items')
        .insert(rows)
        .select(MEAL_ITEM_COLUMNS)
      if (itemError) throwSupabaseError(itemError)
      savedItems.push(...((itemData ?? []) as DailyMealItem[]))
    }
  }

  return { meals: sortMeals(savedMeals), items: sortMealItems(savedItems) }
}

/**
 * 只改「这一餐吃没吃」，不碰内容项。
 * 目标餐次还不存在时顺手建一条空记录，这样「没安排但确实吃了」也能勾上。
 */
export async function setMealCompleted(
  planDate: string,
  mealType: MealType,
  completed: boolean,
): Promise<DailyMeal[]> {
  assertWritableDate(planDate)
  const plan = await ensurePlan(planDate)
  const existing = (await listMeals(plan.id)).find((meal) => meal.meal_type === mealType)

  const { error } = await client()
    .from('daily_meals')
    .upsert(
      {
        day_plan_id: plan.id,
        meal_type: mealType,
        note: existing?.note ?? '',
        completed,
      },
      { onConflict: 'day_plan_id,meal_type' },
    )
  if (error) throwSupabaseError(error)
  return listMeals(plan.id)
}

// ---------------------------------------------------------------- 补剂

async function rawSupplements(dayPlanId: string): Promise<DailySupplement[]> {
  const { data, error } = await client()
    .from('daily_supplements')
    .select(SUPPLEMENT_COLUMNS)
    .eq('day_plan_id', dayPlanId)
  if (error) throwSupabaseError(error)
  return sortSupplements((data ?? []) as DailySupplement[])
}

/**
 * 取该天的补剂实例，并在需要时按当前启用模板补齐缺失项。
 * 补齐规则与本地一致：只在写入日期发生、只补缺失、去重键是「时段 + 名称快照」。
 */
export async function ensureDaySupplements(planDate: string): Promise<DailySupplement[]> {
  const plan = await getDayPlan(planDate)
  if (!plan) return []
  const existing = await rawSupplements(plan.id)
  if (isHistory(planDate)) return existing

  const templates = await listSelectableOptions('supplement')
  const seen = new Set(existing.map((row) => `${row.period}:${row.name_snapshot}`))
  let nextOrder = existing.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1
  const additions: Array<Record<string, unknown>> = []

  for (const template of templates) {
    const key = `${template.period}:${template.name}`
    if (seen.has(key)) continue
    seen.add(key)
    additions.push({
      day_plan_id: plan.id,
      name_snapshot: template.name,
      period: template.period,
      planned: true,
      completed: false,
      sort_order: nextOrder,
    })
    nextOrder += 1
  }

  if (!additions.length) return existing
  const { error } = await client().from('daily_supplements').insert(additions)
  if (error) throwSupabaseError(error)
  return rawSupplements(plan.id)
}

export async function listDaySupplements(dayPlanId: string): Promise<DailySupplement[]> {
  return rawSupplements(dayPlanId)
}

/**
 * 保存该天的补剂实例：面板提交的就是这一天的完整清单。
 * `planned` 是内容（复制计划会带走），`completed` 是执行状态（复制计划不带）。
 * 入库前同样做清洗：去掉空名称、按「时段 + 名称」去重（与补齐逻辑同一个键）。
 */
export async function saveDaySupplements(planDate: string, rows: SupplementInput[]): Promise<DailySupplement[]> {
  assertWritableDate(planDate)
  const plan = await ensurePlan(planDate)
  const existing = await rawSupplements(plan.id)
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
    const payload: Record<string, unknown> = {
      day_plan_id: plan.id,
      name_snapshot: row.name,
      period: row.period,
      planned: row.planned,
      completed: row.completed,
      sort_order: index,
    }
    if (kept) payload.id = kept.id

    // 有 id 走 update、没有走 insert，而不是一律 upsert：
    // 「行里带着 id 但库里没有」时，本地实现会**另造一个新 id**（`kept?.id ?? newId()`），
    // upsert 则会把这个 id 原样插进去。两种写法对同一个输入给出不同的主键，
    // 属于最不该出现的那类后端差异。
    const mutation = kept
      ? client().from('daily_supplements').update(payload).eq('id', kept.id)
      : client().from('daily_supplements').insert(payload)
    const { data, error } = await mutation.select(SUPPLEMENT_COLUMNS).single()
    if (error) throwSupabaseError(error)
    const record = data as DailySupplement
    saved.push(record)
    keptIds.add(record.id)
  }

  const stale = existing.filter((row) => !keptIds.has(row.id)).map((row) => row.id)
  if (stale.length) {
    const { error } = await client().from('daily_supplements').delete().in('id', stale)
    if (error) throwSupabaseError(error)
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

  const row = (await rawSupplements(plan.id)).find((item) => item.id === id)
  if (row) {
    const { error } = await client().from('daily_supplements').update({ completed }).eq('id', id)
    if (error) throwSupabaseError(error)
  }
  return rawSupplements(plan.id)
}

// ---------------------------------------------------------------- 健身

export async function listExerciseItems(dayPlanId: string): Promise<DailyExerciseItem[]> {
  const { data, error } = await client()
    .from('daily_exercise_items')
    .select(EXERCISE_ITEM_COLUMNS)
    .eq('day_plan_id', dayPlanId)
  if (error) throwSupabaseError(error)
  return sortItems((data ?? []) as DailyExerciseItem[])
}

/**
 * 保存健身安排。选择「不健身」时**不清空**已选项目：它们是内容，切回健身时能原样恢复。
 */
export async function saveExercise(
  planDate: string,
  input: ExerciseInput,
): Promise<{ plan: DayPlan; items: DailyExerciseItem[] }> {
  assertWritableDate(planDate)
  const plan = await ensurePlan(planDate)
  const next = await upsertDayPlan(planDate, {
    exercise_decision: input.decision,
    exercise_note: input.note,
  })

  const { error: clearError } = await client().from('daily_exercise_items').delete().eq('day_plan_id', plan.id)
  if (clearError) throwSupabaseError(clearError)

  if (!input.items.length) return { plan: next, items: [] }

  const rows = input.items.map((item, index) => ({
    day_plan_id: next.id,
    exercise_option_id: item.optionId,
    name_snapshot: item.name,
    sort_order: index,
  }))
  const { data, error } = await client().from('daily_exercise_items').insert(rows).select(EXERCISE_ITEM_COLUMNS)
  if (error) throwSupabaseError(error)
  return { plan: next, items: sortItems((data ?? []) as DailyExerciseItem[]) }
}

// ---------------------------------------------------------------- 自定义事项

export async function listCustomTasks(dayPlanId: string): Promise<CustomTask[]> {
  const { data, error } = await client()
    .from('custom_tasks')
    .select(TASK_COLUMNS)
    .eq('day_plan_id', dayPlanId)
    .order('task_time')
  if (error) throwSupabaseError(error)
  return (data ?? []) as CustomTask[]
}

export async function saveCustomTask(
  planDate: string,
  task: Partial<CustomTask> & { task_time: string; title: string; note: string; completed: boolean },
): Promise<CustomTask> {
  assertWritableDate(planDate)
  const plan = await ensurePlan(planDate)

  if (task.id) {
    const { data, error } = await client()
      .from('custom_tasks')
      .upsert(
        {
          id: task.id,
          day_plan_id: plan.id,
          task_time: task.task_time,
          title: task.title,
          note: task.note,
          completed: task.completed,
        },
        { onConflict: 'id' },
      )
      .select(TASK_COLUMNS)
      .single()
    if (error) throwSupabaseError(error)
    return data as CustomTask
  }

  const { data, error } = await client()
    .from('custom_tasks')
    .insert({
      day_plan_id: plan.id,
      task_time: task.task_time,
      title: task.title,
      note: task.note,
      completed: task.completed,
    })
    .select(TASK_COLUMNS)
    .single()
  if (error) throwSupabaseError(error)
  return data as CustomTask
}

export async function deleteCustomTask(planDate: string, id: string): Promise<void> {
  assertWritableDate(planDate)
  const plan = await getDayPlan(planDate)
  if (!plan) return
  const { data, error } = await client().from('custom_tasks').select(TASK_COLUMNS).eq('day_plan_id', plan.id)
  if (error) throwSupabaseError(error)
  if (!((data ?? []) as CustomTask[]).some((item) => item.id === id)) return

  const { error: deleteError } = await client().from('custom_tasks').delete().eq('id', id)
  if (deleteError) throwSupabaseError(deleteError)
}

// ---------------------------------------------------------------- 休息日家务

export async function listRoutineTasks(dayPlanId: string): Promise<RoutineTask[]> {
  const { data, error } = await client().from('routine_tasks').select(ROUTINE_COLUMNS).eq('day_plan_id', dayPlanId)
  if (error) throwSupabaseError(error)
  return sortRoutines((data ?? []) as RoutineTask[])
}

/**
 * 取该天的休息日家务，并在需要时补齐「拖地 / 洗衣」两个每日实例。
 * 只在**正常休息日**补齐——`mode === 'rest'` 且 `mode_override === false`；
 * 临时不上班（工作日人工切 rest）不自动带家务（docs/00）。
 */
export async function ensureRestDayRoutines(planDate: string): Promise<RoutineTask[]> {
  const plan = await getDayPlan(planDate)
  if (!plan) return []
  const existing = await listRoutineTasks(plan.id)
  if (isHistory(planDate)) return existing
  if (plan.mode !== 'rest' || plan.mode_override) return existing

  const seen = new Set(existing.map((row) => row.kind))
  const additions = ROUTINE_ORDER.filter((kind) => !seen.has(kind)).map((kind) => ({
    day_plan_id: plan.id,
    kind,
    title: ROUTINE_TITLES[kind],
    completed: false,
  }))
  if (!additions.length) return existing

  const { error } = await client().from('routine_tasks').insert(additions)
  if (error) throwSupabaseError(error)
  return listRoutineTasks(plan.id)
}

/** 只翻某一条家务的「做没做」，内容与顺序都不动。 */
export async function setRoutineCompleted(
  planDate: string,
  id: string,
  completed: boolean,
): Promise<RoutineTask[]> {
  assertWritableDate(planDate)
  const plan = await getDayPlan(planDate)
  if (!plan) return []

  const row = (await listRoutineTasks(plan.id)).find((item) => item.id === id)
  if (row) {
    const { error } = await client().from('routine_tasks').update({ completed }).eq('id', id)
    if (error) throwSupabaseError(error)
  }
  return listRoutineTasks(plan.id)
}

// ---------------------------------------------------------------- 复制

/**
 * 复制昨天：服务端 RPC 一次做完，只带走内容与名称快照，绝不带走执行状态。
 * 家务不参与复制；目标日的 mode / mode_override 也不被复制改变（理由见 SQL 注释）。
 *
 * 必须用 RPC 而不是客户端逐表写入：跨表复制要么全成、要么全不成，
 * 断网或中途失败时客户端逐表写会留下写了一半的目标日。
 */
export async function copyYesterday(planDate: string): Promise<DayPlan> {
  assertWritableDate(planDate)
  const { error } = await client().rpc('copy_yesterday_stage4', { target_date: planDate })
  if (error) throwSupabaseError(error)

  const plan = await getDayPlan(planDate)
  if (!plan) throw new Error('复制昨天失败，请重试。')
  return plan
}
