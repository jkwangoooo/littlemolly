import type { CustomTask, DailyMeal, DayMode, DayPlan } from '../shared/types/dayPlan'
import { defaultModeForDate, getBusinessDateKey } from '../shared/date/dateUtils'
import { requireSupabase } from './supabase'

export type SupabaseDataError = Error & {
  code?: string
  details?: string
  hint?: string
  status?: number
}

export function normalizeSupabaseError(error: unknown): SupabaseDataError {
  if (error instanceof Error) return error as SupabaseDataError
  const value = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const message = typeof value.message === 'string' ? value.message : '发生未知错误。'
  const normalized = new Error(message) as SupabaseDataError
  if (typeof value.code === 'string') normalized.code = value.code
  if (typeof value.details === 'string') normalized.details = value.details
  if (typeof value.hint === 'string') normalized.hint = value.hint
  if (typeof value.status === 'number') normalized.status = value.status
  return normalized
}

function throwSupabaseError(error: unknown): never {
  throw normalizeSupabaseError(error)
}

const columns = 'id,user_id,plan_date,mode,mode_override,created_at,updated_at,outfit_ready,meals_ready,supplements_ready,morning_ready,exercise_ready,morning_focus,morning_completed,exercise_decision,exercise_content,exercise_note,exercise_completed'
const mealColumns = 'id,day_plan_id,meal_type,plan_content,note,completed'
const taskColumns = 'id,day_plan_id,task_time,title,note,completed'

function assertWritableDate(planDate: string): void {
  if (planDate < getBusinessDateKey()) throw new Error('历史日期不可修改。')
}

export async function getDayPlan(planDate: string): Promise<DayPlan | null> {
  const { data, error } = await requireSupabase().from('day_plans').select(columns).eq('plan_date', planDate).maybeSingle()
  if (error) throwSupabaseError(error)
  return data as DayPlan | null
}

export async function listDayPlans(planDates: string[]): Promise<DayPlan[]> {
  if (planDates.length === 0) return []
  const { data, error } = await requireSupabase().from('day_plans').select(columns).in('plan_date', planDates).order('plan_date')
  if (error) throwSupabaseError(error)
  return (data ?? []) as DayPlan[]
}

export async function upsertDayPlan(planDate: string, patch: Partial<DayPlan> & { mode?: DayMode; mode_override?: boolean } = {}): Promise<DayPlan> {
  assertWritableDate(planDate)
  const { data, error } = await requireSupabase().from('day_plans').upsert({ plan_date: planDate, ...patch }, { onConflict: 'user_id,plan_date' }).select(columns).single()
  if (error) throwSupabaseError(error)
  return data as DayPlan
}

export async function restoreDefaultDayPlan(planDate: string, defaultMode: DayMode): Promise<DayPlan> {
  return upsertDayPlan(planDate, { mode: defaultMode, mode_override: false })
}

export async function listMeals(dayPlanId: string): Promise<DailyMeal[]> { const { data, error } = await requireSupabase().from('daily_meals').select(mealColumns).eq('day_plan_id', dayPlanId).order('meal_type'); if (error) throwSupabaseError(error); return (data ?? []) as DailyMeal[] }
export async function saveMeals(planDate: string, meals: Array<Pick<DailyMeal, 'meal_type' | 'plan_content' | 'note' | 'completed'>>): Promise<DailyMeal[]> {
  assertWritableDate(planDate); const plan = await getDayPlan(planDate) ?? await upsertDayPlan(planDate, { mode: defaultModeForDate(planDate), mode_override: false }); const rows = meals.map((meal) => ({ ...meal, day_plan_id: plan.id })); const { data, error } = await requireSupabase().from('daily_meals').upsert(rows, { onConflict: 'day_plan_id,meal_type' }).select(mealColumns); if (error) throwSupabaseError(error); return (data ?? []) as DailyMeal[]
}
export async function listCustomTasks(dayPlanId: string): Promise<CustomTask[]> { const { data, error } = await requireSupabase().from('custom_tasks').select(taskColumns).eq('day_plan_id', dayPlanId).order('task_time'); if (error) throwSupabaseError(error); return (data ?? []) as CustomTask[] }
export async function saveCustomTask(planDate: string, task: Partial<CustomTask> & { task_time: string; title: string; note: string; completed: boolean }): Promise<CustomTask> {
  assertWritableDate(planDate); const plan = await getDayPlan(planDate) ?? await upsertDayPlan(planDate, { mode: defaultModeForDate(planDate), mode_override: false }); const { data, error } = await requireSupabase().from('custom_tasks').upsert({ ...task, day_plan_id: plan.id }, { onConflict: 'id' }).select(taskColumns).single(); if (error) throwSupabaseError(error); return data as CustomTask
}
export async function deleteCustomTask(planDate: string, id: string) { assertWritableDate(planDate); const { error } = await requireSupabase().from('custom_tasks').delete().eq('id', id); if (error) throwSupabaseError(error) }
export async function copyYesterday(planDate: string) { assertWritableDate(planDate); const { error } = await requireSupabase().rpc('copy_yesterday_stage3', { target_date: planDate }); if (error) throwSupabaseError(error); return getDayPlan(planDate) }
