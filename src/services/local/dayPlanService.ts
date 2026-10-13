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
<<<<<<< HEAD
import type { SupplementPeriod, SupplementTemplate } from '../../shared/types/options'
import { SUPPLEMENT_PERIODS } from '../../shared/types/options'
import { addDays, defaultModeForDate, getBusinessDateKey } from '../../shared/date/dateUtils'
import { assertAuthContextCurrent, captureAuthContext, type AuthContext } from '../session'
import {
  atomicReadWrite, newId, readModifyWrite, readTransaction,
  type LocalStore, type TransactionReader, type TransactionWork, type UserDataStore,
} from './localDb'
import { requireOwnedRecord } from './workspaceRecords'
=======
import type { SupplementPeriod } from '../../shared/types/options'
import { SUPPLEMENT_PERIODS } from '../../shared/types/options'
import { addDays, defaultModeForDate, getBusinessDateKey } from '../../shared/date/dateUtils'
import { currentUser } from './authService'
import { getAll, newId, put, remove } from './localDb'
import { listSelectableOptions } from './optionService'
>>>>>>> origin/main

/**
 * 单日计划的读写（本地后端）。
 *
 * 内容与状态严格分离（docs/01 不变量 5 / 6）：
 * - 内容是「名称快照 + 时段/备注」，选项改名、停用、删除都不改写已有计划；
 * - 状态是各项 `completed` 与五个 `*_ready`，复制计划一律不带。
 *
 * 面板输入的形状（`MealInput` / `SupplementInput` / `ExerciseInput`）定义在
 * `shared/types/dayPlan.ts`，与云端适配器共用；这里重新导出，保持原有导入路径可用。
 */

export type { ExerciseInput, MealInput, SupplementInput }

<<<<<<< HEAD
function ownedWrite(context: AuthContext) {
  return { owner: context.owner, guard: () => assertAuthContextCurrent(context) }
=======
function userId(): string {
  const user = currentUser()
  if (!user) throw new Error('请先登录。')
  return user.id
>>>>>>> origin/main
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

<<<<<<< HEAD
async function plansForUser(reader: TransactionReader, uid: string): Promise<DayPlan[]> {
  return (await reader.getAll<DayPlan>('day_plans')).filter((plan) => plan.user_id === uid)
}

async function mealsForPlan(reader: TransactionReader, id: string): Promise<DailyMeal[]> {
  return (await reader.getAll<DailyMeal>('daily_meals')).filter((meal) => meal.day_plan_id === id)
}

async function mealItemsFor(reader: TransactionReader, dailyMealIds: Set<string>): Promise<DailyMealItem[]> {
  return (await reader.getAll<DailyMealItem>('daily_meal_items')).filter((item) => dailyMealIds.has(item.daily_meal_id))
}

async function childrenFor<T extends { day_plan_id: string }>(
  reader: TransactionReader, store: UserDataStore, id: string,
): Promise<T[]> {
  return (await reader.getAll<T>(store)).filter((row) => row.day_plan_id === id)
}

async function readPlanChildren<T extends { day_plan_id: string }>(
  store: UserDataStore, id: string,
): Promise<T[]> {
  const context = captureAuthContext()
  return readTransaction({
    stores: ['day_plans', store],
    guard: () => assertAuthContextCurrent(context),
    read: async (reader) => {
      await requireOwnedRecord<DayPlan>(reader, 'day_plans', id, context.owner)
      return childrenFor<T>(reader, store, id)
    },
  })
}

async function planForDate(reader: TransactionReader, planDate: string, owner: string): Promise<DayPlan | null> {
  return reader.getByIndex<DayPlan>('day_plans', 'user_date', [owner, planDate])
}

/** 日计划、内容和队列一次提交；回调只能读取同一事务的数据。 */
async function mutateDayPlan<T>(
  planDate: string,
  stores: LocalStore[],
  prepare: (reader: TransactionReader, plan: DayPlan, owner: string) => Promise<{ result: T; work: TransactionWork }>,
  missing?: () => T,
): Promise<T> {
  assertWritableDate(planDate)
  const context = captureAuthContext()
  const snapshot = await atomicReadWrite({
    stores: ['day_plans', ...stores],
    ...ownedWrite(context),
    read: async (reader) => {
      const existing = await planForDate(reader, planDate, context.owner)
      if (!existing && missing) return { result: missing(), work: {} }
      const plan = existing ?? emptyPlan(planDate, context.owner)
      const next = await prepare(reader, plan, context.owner)
      if (!existing && !next.work.put?.some((row) => row.store === 'day_plans' && row.value.id === plan.id)) {
        next.work.put = [{ store: 'day_plans', value: plan }, ...(next.work.put ?? [])]
      }
      return next
    },
    build: ({ work }) => work,
  })
  return snapshot.result
}

/** 删除过的来源可变为空引用，存在的来源必须属于当前 UID。 */
async function sourceOptionId(
  reader: TransactionReader, store: 'food_options' | 'exercise_options', id: string | null, owner: string,
): Promise<string | null> {
  if (id === null) return null
  const option = await reader.get<{ id: string; user_id: string }>(store, id)
  if (!option) return null
  if (option.user_id !== owner) throw new Error('来源选项不属于当前账号。')
  return option.id
}

export async function getDayPlan(planDate: string): Promise<DayPlan | null> {
  const context = captureAuthContext()
  return readTransaction({
    stores: ['day_plans'],
    guard: () => assertAuthContextCurrent(context),
    read: (reader) => planForDate(reader, planDate, context.owner),
  })
}

export async function listDayPlans(planDates: string[]): Promise<DayPlan[]> {
  const context = captureAuthContext()
  const wanted = new Set(planDates)
  return readTransaction({
    stores: ['day_plans'],
    guard: () => assertAuthContextCurrent(context),
    read: async (reader) => (await plansForUser(reader, context.owner))
      .filter((plan) => wanted.has(plan.plan_date))
      .sort((a, b) => a.plan_date.localeCompare(b.plan_date)),
  })
}

/**
 * 取一天的计划，不存在就建一份（可选带 `patch`）。
 *
 * **读-改-写必须在同一个事务里完成**（S4 补丁 ①）。在这之前这里是
 * 「先 `getAll` 找、找不到就 `put` 一条新的」，两段之间隔着事务边界：
 * 两个并发调用会同时读到「不存在」，各建一条、各生成一个 id，
 * 第二条撞上 `day_plans.user_date` 唯一索引，写入整体失败并冒泡到界面
 * （`Unable to add key to index 'user_date'`）。
 *
 * 触发路径不是理论推演：注册后落在休息日时，`useDayPlanData` 会自动建一份 rest 计划，
 * 而界面上的首次写入（`DayPlanScreen.ensurePlan` / `savePlan`）同时也在建同一份；
 * 开发模式下 StrictMode 还会把加载副作用跑两遍，两条路径必然并发。
 *
 * 修法不是加锁，而是**让两次调用串行**：IndexedDB 在创建事务时就开始它，
 * 同一对象仓库上的两个 `readwrite` 事务按顺序排队，于是第二个调用读到的是
 * 第一个已经写好的那一行，再走一次「合并 patch」——结果与顺序执行完全一致。
 * 索引键直接用 `user_date`（那条约束本身），读的就是要守的东西。
 */
=======
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

async function routinesForPlan(id: string): Promise<RoutineTask[]> {
  return (await getAll<RoutineTask>('routine_tasks')).filter((row) => row.day_plan_id === id)
}

async function dropMealItems(dailyMealIds: Set<string>): Promise<void> {
  for (const item of await mealItemsFor(dailyMealIds)) await remove('daily_meal_items', item.id)
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

>>>>>>> origin/main
export async function upsertDayPlan(
  planDate: string,
  patch: Partial<DayPlan> & { mode?: DayMode; mode_override?: boolean } = {},
): Promise<DayPlan> {
  assertWritableDate(planDate)
<<<<<<< HEAD
  const context = captureAuthContext()
  const uid = context.owner
  const timestamp = now()
  return readModifyWrite<DayPlan>({
    stores: ['day_plans'],
    ...ownedWrite(context),
    writeStore: 'day_plans',
    read: (tx) => tx.getByIndex<DayPlan>('day_plans', 'user_date', [uid, planDate]),
    build: (existing) => ({
      ...(existing ?? emptyPlan(planDate, uid)),
      ...patch,
      id: existing?.id ?? newId(),
      user_id: uid,
      plan_date: planDate,
      updated_at: timestamp,
    }),
  })
=======
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
>>>>>>> origin/main
}

export async function restoreDefaultDayPlan(planDate: string, defaultMode: DayMode): Promise<DayPlan> {
  return upsertDayPlan(planDate, { mode: defaultMode, mode_override: false })
}

// ---------------------------------------------------------------- 三餐

export async function listMeals(dayPlanId: string): Promise<DailyMeal[]> {
<<<<<<< HEAD
  return sortMeals(await readPlanChildren<DailyMeal>('daily_meals', dayPlanId))
=======
  return sortMeals(await mealsForPlan(dayPlanId))
>>>>>>> origin/main
}

/** 该天全部餐次的内容项。 */
export async function listMealItems(dayPlanId: string): Promise<DailyMealItem[]> {
<<<<<<< HEAD
  const context = captureAuthContext()
  return readTransaction({
    stores: ['day_plans', 'daily_meals', 'daily_meal_items'],
    guard: () => assertAuthContextCurrent(context),
    read: async (reader) => {
      await requireOwnedRecord<DayPlan>(reader, 'day_plans', dayPlanId, context.owner)
      const meals = await mealsForPlan(reader, dayPlanId)
      return sortMealItems(await mealItemsFor(reader, new Set(meals.map((meal) => meal.id))))
    },
  })
=======
  const meals = await mealsForPlan(dayPlanId)
  const items = await mealItemsFor(new Set(meals.map((meal) => meal.id)))
  return sortMealItems(items)
>>>>>>> origin/main
}

/**
 * 保存三餐。每餐的内容整体替换为面板提交的组合；`completed`（已吃）不在面板里，
 * 因此按已有记录原样保留，避免编辑内容顺手把执行状态清掉。
 */
export async function saveMeals(
  planDate: string,
  meals: MealInput[],
): Promise<{ meals: DailyMeal[]; items: DailyMealItem[] }> {
<<<<<<< HEAD
  if (new Set(meals.map((meal) => meal.meal_type)).size !== meals.length) throw new Error('餐次不能重复。')
  return mutateDayPlan(planDate, ['daily_meals', 'daily_meal_items', 'food_options'], async (reader, plan, owner) => {
    const existingMeals = await mealsForPlan(reader, plan.id)
    const replacedIds = new Set(existingMeals.filter((meal) => meals.some((input) => input.meal_type === meal.meal_type)).map((meal) => meal.id))
    const existingItems = await mealItemsFor(reader, replacedIds)
    const timestamp = now()
    const savedMeals: DailyMeal[] = []
    const savedItems: DailyMealItem[] = []
    for (const input of meals) {
      const kept = existingMeals.find((meal) => meal.meal_type === input.meal_type)
      const meal: DailyMeal = {
        id: kept?.id ?? newId(), day_plan_id: plan.id, meal_type: input.meal_type,
        note: input.note, completed: kept?.completed ?? false,
      }
      savedMeals.push(meal)
      for (const [index, item] of input.items.entries()) {
        savedItems.push({
          id: newId(), daily_meal_id: meal.id,
          food_option_id: await sourceOptionId(reader, 'food_options', item.optionId, owner),
          food_name_snapshot: item.name, sort_order: index, created_at: timestamp,
        })
      }
    }
    return {
      result: { meals: sortMeals(savedMeals), items: sortMealItems(savedItems) },
      work: {
        remove: existingItems.map((row) => ({ store: 'daily_meal_items', id: row.id })),
        put: [
          ...savedMeals.map((value) => ({ store: 'daily_meals' as LocalStore, value })),
          ...savedItems.map((value) => ({ store: 'daily_meal_items' as LocalStore, value })),
        ],
      },
    }
  })
=======
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
>>>>>>> origin/main
}

/**
 * 只改「这一餐吃没吃」，不碰内容项。
 *
 * 执行页的勾选会走这里而不是 `saveMeals`：后者按面板提交整体重建内容项，
 * 用它翻一个勾会把内容项的 id 与 created_at 全部重写一遍，是无谓的副作用。
 * 目标餐次还不存在时顺手建一条空记录，这样「没安排但确实吃了」也能勾上。
<<<<<<< HEAD
 *
 * 与 `upsertDayPlan` 同一个形状的竞态（`daily_meals` 的 `plan_type` 唯一索引），
 * 所以同样走 `readModifyWrite`：连续点两下、或两个标签页同时勾，都只会得到一条记录。
=======
>>>>>>> origin/main
 */
export async function setMealCompleted(
  planDate: string,
  mealType: MealType,
  completed: boolean,
): Promise<DailyMeal[]> {
<<<<<<< HEAD
  return mutateDayPlan(planDate, ['daily_meals'], async (reader, plan) => {
    const rows = await mealsForPlan(reader, plan.id)
    const existing = rows.find((row) => row.meal_type === mealType)
    const next: DailyMeal = {
      id: existing?.id ?? newId(), day_plan_id: plan.id, meal_type: mealType,
      note: existing?.note ?? '', completed,
    }
    return {
      result: sortMeals([...rows.filter((row) => row.id !== next.id), next]),
      work: { put: [{ store: 'daily_meals', value: next }] },
    }
  })
=======
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
>>>>>>> origin/main
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
<<<<<<< HEAD
  const context = captureAuthContext()
  const snapshot = await atomicReadWrite({
    stores: ['day_plans', 'daily_supplements', 'supplement_templates'],
    ...ownedWrite(context),
    read: async (reader) => {
      const plan = await planForDate(reader, planDate, context.owner)
      const additions: DailySupplement[] = []
      if (!plan) return { rows: additions, additions }
      const existing = await childrenFor<DailySupplement>(reader, 'daily_supplements', plan.id)
      if (isHistory(planDate)) return { rows: sortSupplements(existing), additions }
      const templates = (await reader.getAll<SupplementTemplate>('supplement_templates'))
        .filter((row) => row.user_id === context.owner && row.active)
        .sort((left, right) => periodIndex(left.period) - periodIndex(right.period)
          || left.sort_order - right.sort_order || left.name.localeCompare(right.name, 'zh-Hans-CN'))
      const seen = new Set(existing.map((row) => `${row.period}:${row.name_snapshot}`))
      const timestamp = now()
      let nextOrder = existing.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1
      for (const template of templates) {
        const key = `${template.period}:${template.name}`
        if (seen.has(key)) continue
        seen.add(key)
        additions.push({
          id: newId(), day_plan_id: plan.id, name_snapshot: template.name, period: template.period,
          planned: true, completed: false, sort_order: nextOrder++,
          created_at: timestamp, updated_at: timestamp,
        })
      }
      return { rows: sortSupplements([...existing, ...additions]), additions }
    },
    build: ({ additions }) => ({
      put: additions.map((value) => ({ store: 'daily_supplements', value })),
    }),
  })
  return snapshot.rows
}

export async function listDaySupplements(dayPlanId: string): Promise<DailySupplement[]> {
  return sortSupplements(await readPlanChildren<DailySupplement>('daily_supplements', dayPlanId))
=======
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
>>>>>>> origin/main
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
<<<<<<< HEAD
  const seenKeys = new Set<string>()
=======
  assertWritableDate(planDate)
  const plan = (await getDayPlan(planDate)) ?? (await upsertDayPlan(planDate))
  const existing = await supplementsForPlan(plan.id)
  const timestamp = now()
  const saved: DailySupplement[] = []
  const keptIds = new Set<string>()
  const seenKeys = new Set<string>()

>>>>>>> origin/main
  const cleaned = rows
    .map((row) => ({ ...row, name: row.name.trim() }))
    .filter((row) => {
      if (!row.name) return false
      const key = `${row.period}:${row.name}`
      if (seenKeys.has(key)) return false
      seenKeys.add(key)
      return true
    })

<<<<<<< HEAD
  return mutateDayPlan(planDate, ['daily_supplements'], async (reader, plan) => {
    const existing = await childrenFor<DailySupplement>(reader, 'daily_supplements', plan.id)
    const timestamp = now()
    const saved = cleaned.map((row, index): DailySupplement => {
      const kept = row.id ? existing.find((item) => item.id === row.id) : undefined
      if (row.id && !kept) throw new Error('补剂记录不属于这个日期，或已经不存在。')
      return {
        id: kept?.id ?? newId(), day_plan_id: plan.id, name_snapshot: row.name,
        period: row.period, planned: row.planned, completed: row.completed, sort_order: index,
        created_at: kept?.created_at ?? timestamp, updated_at: timestamp,
      }
    })
    const keptIds = new Set(saved.map((row) => row.id))
    return {
      result: sortSupplements(saved),
      work: {
        put: saved.map((value) => ({ store: 'daily_supplements', value })),
        remove: existing.filter((row) => !keptIds.has(row.id)).map((row) => ({ store: 'daily_supplements', id: row.id })),
      },
    }
  })
=======
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
>>>>>>> origin/main
}

/** 只翻某一条补剂的「今天吃没吃」，内容与顺序都不动。 */
export async function setSupplementCompleted(
  planDate: string,
  id: string,
  completed: boolean,
): Promise<DailySupplement[]> {
<<<<<<< HEAD
  return mutateDayPlan(planDate, ['daily_supplements'], async (reader, plan) => {
    const existing = await childrenFor<DailySupplement>(reader, 'daily_supplements', plan.id)
    const row = existing.find((item) => item.id === id)
    const next = row ? { ...row, completed, updated_at: now() } : null
    return {
      result: sortSupplements(existing.map((item) => item.id === id && next ? next : item)),
      work: { put: next ? [{ store: 'daily_supplements', value: next }] : [] },
    }
  }, () => [])
=======
  assertWritableDate(planDate)
  const plan = await getDayPlan(planDate)
  if (!plan) return []

  const row = (await supplementsForPlan(plan.id)).find((item) => item.id === id)
  if (row) await put<DailySupplement>('daily_supplements', { ...row, completed, updated_at: now() })
  return supplementsForPlan(plan.id)
>>>>>>> origin/main
}

// ---------------------------------------------------------------- 健身

export async function listExerciseItems(dayPlanId: string): Promise<DailyExerciseItem[]> {
<<<<<<< HEAD
  return sortItems(await readPlanChildren<DailyExerciseItem>('daily_exercise_items', dayPlanId))
=======
  return exerciseItemsForPlan(dayPlanId)
>>>>>>> origin/main
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
<<<<<<< HEAD
  return mutateDayPlan(planDate, ['daily_exercise_items', 'exercise_options'], async (reader, plan, owner) => {
    const existing = await childrenFor<DailyExerciseItem>(reader, 'daily_exercise_items', plan.id)
    const next = { ...plan, exercise_decision: input.decision, exercise_note: input.note, updated_at: now() }
    const timestamp = now()
    const items: DailyExerciseItem[] = []
    for (const [index, item] of input.items.entries()) {
      items.push({
        id: newId(), day_plan_id: plan.id,
        exercise_option_id: await sourceOptionId(reader, 'exercise_options', item.optionId, owner),
        name_snapshot: item.name, sort_order: index, created_at: timestamp,
      })
    }
    return {
      result: { plan: next, items: sortItems(items) },
      work: {
        remove: existing.map((row) => ({ store: 'daily_exercise_items', id: row.id })),
        put: [
          { store: 'day_plans', value: next },
          ...items.map((value) => ({ store: 'daily_exercise_items' as LocalStore, value })),
        ],
      },
    }
  })
=======
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
>>>>>>> origin/main
}

// ---------------------------------------------------------------- 自定义事项

export async function listCustomTasks(dayPlanId: string): Promise<CustomTask[]> {
<<<<<<< HEAD
  return (await readPlanChildren<CustomTask>('custom_tasks', dayPlanId))
    .sort((a, b) => a.task_time.localeCompare(b.task_time))
=======
  return (await tasksForPlan(dayPlanId)).sort((a, b) => a.task_time.localeCompare(b.task_time))
>>>>>>> origin/main
}

export async function saveCustomTask(
  planDate: string,
  task: Partial<CustomTask> & { task_time: string; title: string; note: string; completed: boolean },
): Promise<CustomTask> {
<<<<<<< HEAD
  return mutateDayPlan(planDate, ['custom_tasks'], async (reader, plan, owner) => {
    if (task.id) {
      const existing = await requireOwnedRecord<CustomTask>(reader, 'custom_tasks', task.id, owner)
      if (existing.day_plan_id !== plan.id) throw new Error('事项不属于这个日期。')
    }
    const next: CustomTask = {
      id: task.id ?? newId(), day_plan_id: plan.id, task_time: task.task_time,
      title: task.title, note: task.note, completed: task.completed,
    }
    return { result: next, work: { put: [{ store: 'custom_tasks', value: next }] } }
  })
}

export async function deleteCustomTask(planDate: string, id: string): Promise<void> {
  return mutateDayPlan(planDate, ['custom_tasks'], async (reader, plan, owner) => {
    const row = await reader.get<CustomTask>('custom_tasks', id)
    if (!row) return { result: undefined, work: {} }
    const task = await requireOwnedRecord<CustomTask>(reader, 'custom_tasks', id, owner)
    if (task.day_plan_id !== plan.id) throw new Error('事项不属于这个日期。')
    return { result: undefined, work: { remove: [{ store: 'custom_tasks', id }] } }
  }, () => undefined)
=======
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
>>>>>>> origin/main
}

// ---------------------------------------------------------------- 休息日家务

function sortRoutines(list: RoutineTask[]): RoutineTask[] {
  return [...list].sort((left, right) => ROUTINE_ORDER.indexOf(left.kind) - ROUTINE_ORDER.indexOf(right.kind))
}

export async function listRoutineTasks(dayPlanId: string): Promise<RoutineTask[]> {
<<<<<<< HEAD
  return sortRoutines(await readPlanChildren<RoutineTask>('routine_tasks', dayPlanId))
=======
  return sortRoutines(await routinesForPlan(dayPlanId))
>>>>>>> origin/main
}

/**
 * 取该天的休息日家务，并在需要时补齐「拖地 / 洗衣」两个每日实例。
 *
 * 补齐规则（docs/00「仅正常休息日」）：
 * - 只在「正常休息日」补齐——`mode === 'rest'` 且 `mode_override === false`；
 *   临时不上班（工作日人工切 rest，`mode_override === true`）不自动带家务；
 * - 历史日期只读，不补；
 * - 只补缺失，不删除、不改写已有实例。
 */
export async function ensureRestDayRoutines(planDate: string): Promise<RoutineTask[]> {
<<<<<<< HEAD
  const context = captureAuthContext()
  const snapshot = await atomicReadWrite({
    stores: ['day_plans', 'routine_tasks'],
    ...ownedWrite(context),
    read: async (reader) => {
      const additions: RoutineTask[] = []
      const plan = await planForDate(reader, planDate, context.owner)
      if (!plan) return { rows: additions, additions }
      const existing = await childrenFor<RoutineTask>(reader, 'routine_tasks', plan.id)
      if (isHistory(planDate) || plan.mode !== 'rest' || plan.mode_override) {
        return { rows: sortRoutines(existing), additions }
      }
      const seen = new Set(existing.map((row) => row.kind))
      for (const kind of ROUTINE_ORDER) {
        if (seen.has(kind)) continue
        additions.push({
          id: newId(), day_plan_id: plan.id, kind, title: ROUTINE_TITLES[kind], completed: false,
        })
      }
      return { rows: sortRoutines([...existing, ...additions]), additions }
    },
    build: ({ additions }) => ({
      put: additions.map((value) => ({ store: 'routine_tasks', value })),
    }),
  })
  return snapshot.rows
=======
  const plan = await getDayPlan(planDate)
  if (!plan) return []
  const existing = await routinesForPlan(plan.id)
  if (isHistory(planDate)) return existing
  if (plan.mode !== 'rest' || plan.mode_override) return existing

  const seen = new Set(existing.map((row) => row.kind))
  let changed = false
  for (const kind of ROUTINE_ORDER) {
    if (seen.has(kind)) continue
    await put<RoutineTask>('routine_tasks', {
      id: newId(),
      day_plan_id: plan.id,
      kind,
      title: ROUTINE_TITLES[kind],
      completed: false,
    })
    changed = true
  }
  return changed ? sortRoutines(await routinesForPlan(plan.id)) : sortRoutines(existing)
>>>>>>> origin/main
}

/** 只翻某一条家务的「做没做」，内容与顺序都不动。 */
export async function setRoutineCompleted(
  planDate: string,
  id: string,
  completed: boolean,
): Promise<RoutineTask[]> {
<<<<<<< HEAD
  return mutateDayPlan(planDate, ['routine_tasks'], async (reader, plan) => {
    const rows = await childrenFor<RoutineTask>(reader, 'routine_tasks', plan.id)
    const row = rows.find((item) => item.id === id)
    const next = row ? { ...row, completed } : null
    return {
      result: sortRoutines(rows.map((item) => item.id === id && next ? next : item)),
      work: { put: next ? [{ store: 'routine_tasks', value: next }] : [] },
    }
  }, () => [])
=======
  assertWritableDate(planDate)
  const plan = await getDayPlan(planDate)
  if (!plan) return []

  const row = (await routinesForPlan(plan.id)).find((item) => item.id === id)
  if (row) await put<RoutineTask>('routine_tasks', { ...row, completed })
  return sortRoutines(await routinesForPlan(plan.id))
>>>>>>> origin/main
}

// ---------------------------------------------------------------- 复制

/**
 * 复制昨天：只带走内容与名称快照，绝不带走执行状态。
 *
 * 带走：晨间内容、健身决定、三餐内容与备注、补剂实例（名称 / 时段 / 是否计划）、
 *       健身项目、自定义事项。
 * 不带：五个准备勾选、三餐完成、补剂完成、晨间完成、健身完成，以及目标日自己的
 *       模式与 `mode_override`（复制不改变这一天是工作日还是休息日）。
 *
 * 家务（routine_tasks）完全不参与复制：它是休息日按日自动生成的每日实例，
 * 由 `ensureRestDayRoutines` 独立管理；复制既不带走来源日的家务，也不动目标日已有的家务。
 */
export async function copyYesterday(planDate: string): Promise<DayPlan> {
<<<<<<< HEAD
  return mutateDayPlan(planDate, [
    'daily_meals', 'daily_meal_items', 'daily_supplements', 'daily_exercise_items',
    'custom_tasks', 'food_options', 'exercise_options',
  ], async (reader, existingTarget, owner) => {
    const source = await planForDate(reader, addDays(planDate, -1), owner)
    if (!source) throw new Error('昨天没有可复制的计划。')
    const timestamp = now()
    const target: DayPlan = {
      ...existingTarget,
      morning_focus: source.morning_focus, exercise_decision: source.exercise_decision,
      exercise_note: source.exercise_note, outfit_ready: false, meals_ready: false,
      supplements_ready: false, morning_ready: false, exercise_ready: false,
      morning_completed: false, exercise_completed: false, updated_at: timestamp,
    }
    const [sourceMeals, targetMeals, sourceSupplements, targetSupplements, sourceExercises,
      targetExercises, sourceTasks, targetTasks] = await Promise.all([
      mealsForPlan(reader, source.id),
      mealsForPlan(reader, target.id),
      childrenFor<DailySupplement>(reader, 'daily_supplements', source.id),
      childrenFor<DailySupplement>(reader, 'daily_supplements', target.id),
      childrenFor<DailyExerciseItem>(reader, 'daily_exercise_items', source.id),
      childrenFor<DailyExerciseItem>(reader, 'daily_exercise_items', target.id),
      childrenFor<CustomTask>(reader, 'custom_tasks', source.id),
      childrenFor<CustomTask>(reader, 'custom_tasks', target.id),
    ])
    const [sourceItems, targetItems] = await Promise.all([
      mealItemsFor(reader, new Set(sourceMeals.map((meal) => meal.id))),
      mealItemsFor(reader, new Set(targetMeals.map((meal) => meal.id))),
    ])
    const puts: NonNullable<TransactionWork['put']> = [{ store: 'day_plans', value: target }]
    for (const meal of sourceMeals) {
      const copied: DailyMeal = {
        id: newId(), day_plan_id: target.id, meal_type: meal.meal_type,
        note: meal.note, completed: false,
      }
      puts.push({ store: 'daily_meals', value: copied })
      for (const item of sourceItems.filter((row) => row.daily_meal_id === meal.id)) {
        const copiedItem: DailyMealItem = {
          ...item, id: newId(), daily_meal_id: copied.id,
          food_option_id: await sourceOptionId(reader, 'food_options', item.food_option_id, owner),
        }
        puts.push({ store: 'daily_meal_items', value: copiedItem })
      }
    }
    for (const row of sourceSupplements) {
      const copied: DailySupplement = {
        ...row, id: newId(), day_plan_id: target.id, completed: false, updated_at: timestamp,
      }
      puts.push({ store: 'daily_supplements', value: copied })
    }
    for (const row of sourceExercises) {
      const copied: DailyExerciseItem = {
        ...row, id: newId(), day_plan_id: target.id,
        exercise_option_id: await sourceOptionId(reader, 'exercise_options', row.exercise_option_id, owner),
      }
      puts.push({ store: 'daily_exercise_items', value: copied })
    }
    for (const row of sourceTasks) {
      const copied: CustomTask = { ...row, id: newId(), day_plan_id: target.id, completed: false }
      puts.push({ store: 'custom_tasks', value: copied })
    }
    return {
      result: target,
      work: {
        put: puts,
        remove: [
          ...targetItems.map((row) => ({ store: 'daily_meal_items' as LocalStore, id: row.id })),
          ...targetMeals.map((row) => ({ store: 'daily_meals' as LocalStore, id: row.id })),
          ...targetSupplements.map((row) => ({ store: 'daily_supplements' as LocalStore, id: row.id })),
          ...targetExercises.map((row) => ({ store: 'daily_exercise_items' as LocalStore, id: row.id })),
          ...targetTasks.map((row) => ({ store: 'custom_tasks' as LocalStore, id: row.id })),
        ],
      },
    }
  })
=======
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
>>>>>>> origin/main
}
