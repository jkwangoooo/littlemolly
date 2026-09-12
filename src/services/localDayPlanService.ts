import type { CustomTask, DailyMeal, DayMode, DayPlan } from '../shared/types/dayPlan'
import { addDays, defaultModeForDate, getBusinessDateKey } from '../shared/date/dateUtils'
import { currentUser } from './authService'
import { getAll, newId, put, remove } from './localDb'

export type LocalDataError = Error & { code?: string; details?: string; hint?: string; status?: number }

export function normalizeSupabaseError(error: unknown): LocalDataError {
  if (error instanceof Error) return error as LocalDataError
  return new Error(typeof error === 'string' ? error : '发生未知错误。') as LocalDataError
}

function userId(): string {
  const user = currentUser()
  if (!user) throw new Error('请先登录。')
  return user.id
}

function assertWritableDate(planDate: string): void {
  if (planDate < getBusinessDateKey()) throw new Error('历史日期不可修改。')
}

function now(): string { return new Date().toISOString() }

function emptyPlan(planDate: string, uid: string): DayPlan {
  const timestamp = now()
  return { id: newId(), user_id: uid, plan_date: planDate, mode: defaultModeForDate(planDate), mode_override: false, created_at: timestamp, updated_at: timestamp, outfit_ready: false, meals_ready: false, supplements_ready: false, morning_ready: false, exercise_ready: false, morning_focus: '', morning_completed: false, exercise_decision: 'undecided', exercise_content: '', exercise_note: '', exercise_completed: false }
}

async function plansForUser(uid: string): Promise<DayPlan[]> { return (await getAll<DayPlan>('day_plans')).filter((plan) => plan.user_id === uid) }
async function mealsForPlan(id: string): Promise<DailyMeal[]> { return (await getAll<DailyMeal>('daily_meals')).filter((meal) => meal.day_plan_id === id) }
async function tasksForPlan(id: string): Promise<CustomTask[]> { return (await getAll<CustomTask>('custom_tasks')).filter((task) => task.day_plan_id === id) }

export async function getDayPlan(planDate: string): Promise<DayPlan | null> {
  const uid = userId()
  return (await plansForUser(uid)).find((plan) => plan.plan_date === planDate) ?? null
}

export async function listDayPlans(planDates: string[]): Promise<DayPlan[]> {
  const wanted = new Set(planDates)
  return (await plansForUser(userId())).filter((plan) => wanted.has(plan.plan_date)).sort((a, b) => a.plan_date.localeCompare(b.plan_date))
}

export async function upsertDayPlan(planDate: string, patch: Partial<DayPlan> & { mode?: DayMode; mode_override?: boolean } = {}): Promise<DayPlan> {
  assertWritableDate(planDate)
  const uid = userId(); const existing = (await plansForUser(uid)).find((plan) => plan.plan_date === planDate)
  const next: DayPlan = { ...(existing ?? emptyPlan(planDate, uid)), ...patch, id: existing?.id ?? newId(), user_id: uid, plan_date: planDate, updated_at: now() }
  await put('day_plans', next)
  return next
}

export async function restoreDefaultDayPlan(planDate: string, defaultMode: DayMode): Promise<DayPlan> { return upsertDayPlan(planDate, { mode: defaultMode, mode_override: false }) }

export async function listMeals(dayPlanId: string): Promise<DailyMeal[]> { return (await mealsForPlan(dayPlanId)).sort((a, b) => a.meal_type.localeCompare(b.meal_type)) }

export async function saveMeals(planDate: string, meals: Array<Pick<DailyMeal, 'meal_type' | 'plan_content' | 'note' | 'completed'>>): Promise<DailyMeal[]> {
  assertWritableDate(planDate); const plan = await getDayPlan(planDate) ?? await upsertDayPlan(planDate)
  const existing = await mealsForPlan(plan.id)
  const saved: DailyMeal[] = []
  for (const meal of meals) {
    const next: DailyMeal = { id: existing.find((item) => item.meal_type === meal.meal_type)?.id ?? newId(), day_plan_id: plan.id, meal_type: meal.meal_type, plan_content: meal.plan_content, note: meal.note, completed: meal.completed }
    await put('daily_meals', next); saved.push(next)
  }
  return saved.sort((a, b) => a.meal_type.localeCompare(b.meal_type))
}

export async function listCustomTasks(dayPlanId: string): Promise<CustomTask[]> { return (await tasksForPlan(dayPlanId)).sort((a, b) => a.task_time.localeCompare(b.task_time)) }

export async function saveCustomTask(planDate: string, task: Partial<CustomTask> & { task_time: string; title: string; note: string; completed: boolean }): Promise<CustomTask> {
  assertWritableDate(planDate); const plan = await getDayPlan(planDate) ?? await upsertDayPlan(planDate); const next: CustomTask = { id: task.id ?? newId(), day_plan_id: plan.id, task_time: task.task_time, title: task.title, note: task.note, completed: task.completed }
  await put('custom_tasks', next); return next
}

export async function deleteCustomTask(planDate: string, id: string): Promise<void> {
  assertWritableDate(planDate); const plan = await getDayPlan(planDate); if (!plan) return
  const task = (await tasksForPlan(plan.id)).find((item) => item.id === id); if (task) await remove('custom_tasks', id)
}

export async function copyYesterday(planDate: string): Promise<DayPlan> {
  assertWritableDate(planDate); const uid = userId(); const source = (await plansForUser(uid)).find((plan) => plan.plan_date === addDays(planDate, -1)); if (!source) throw new Error('昨天没有可复制的计划。')
  const targetExisting = (await plansForUser(uid)).find((plan) => plan.plan_date === planDate)
  const target: DayPlan = { ...(targetExisting ?? emptyPlan(planDate, uid)), id: targetExisting?.id ?? newId(), user_id: uid, plan_date: planDate, morning_focus: source.morning_focus, exercise_decision: source.exercise_decision, exercise_content: source.exercise_content, exercise_note: source.exercise_note, outfit_ready: false, meals_ready: false, supplements_ready: false, morning_ready: false, exercise_ready: false, morning_completed: false, exercise_completed: false, updated_at: now() }
  await put('day_plans', target)
  for (const meal of await mealsForPlan(target.id)) await remove('daily_meals', meal.id)
  for (const meal of await mealsForPlan(source.id)) await put('daily_meals', { ...meal, id: newId(), day_plan_id: target.id, completed: false })
  for (const task of await tasksForPlan(target.id)) await remove('custom_tasks', task.id)
  for (const task of await tasksForPlan(source.id)) await put('custom_tasks', { ...task, id: newId(), day_plan_id: target.id, completed: false })
  return target
}
