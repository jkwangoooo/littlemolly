export type DayMode = 'work' | 'rest'

export interface DayPlan {
  id: string
  user_id: string
  plan_date: string
  mode: DayMode
  mode_override: boolean
  created_at: string
  updated_at: string
  outfit_ready: boolean
  meals_ready: boolean
  supplements_ready: boolean
  morning_ready: boolean
  exercise_ready: boolean
  morning_focus: string
  morning_completed: boolean
  exercise_decision: 'undecided' | 'exercise' | 'rest'
  exercise_content: string
  exercise_note: string
  exercise_completed: boolean
}

export type MealType = 'breakfast' | 'lunch' | 'dinner'
export interface DailyMeal { id: string; day_plan_id: string; meal_type: MealType; plan_content: string; note: string; completed: boolean }
export interface CustomTask { id: string; day_plan_id: string; task_time: string; title: string; note: string; completed: boolean }
