import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { captureAuthContext, isAuthContextCurrent } from '../../services/api/authService'
import type {
  CustomTask,
  DailyExerciseItem,
  DailyMeal,
  DailyMealItem,
  DailySupplement,
  DayPlan,
  RoutineTask,
} from '../../shared/types/dayPlan'
import { describeDataError } from '../../shared/errors'
import { defaultModeForDate, isHistorical } from '../../shared/date/dateUtils'
import {
  ensureRestDayRoutines,
  getDayPlan,
  listCustomTasks,
  listDaySupplements,
  listExerciseItems,
  listMealItems,
  listMeals,
  listRoutineTasks,
  upsertDayPlan,
} from '../../services/api/dayPlanService'

export type DayPlanData = {
  plan: DayPlan | null
  meals: DailyMeal[]
  mealItems: DailyMealItem[]
  supplements: DailySupplement[]
  exerciseItems: DailyExerciseItem[]
  tasks: CustomTask[]
  routines: RoutineTask[]
  loading: boolean
  loadError: string | null
  setPlan: Dispatch<SetStateAction<DayPlan | null>>
  setMeals: Dispatch<SetStateAction<DailyMeal[]>>
  setMealItems: Dispatch<SetStateAction<DailyMealItem[]>>
  setSupplements: Dispatch<SetStateAction<DailySupplement[]>>
  setExerciseItems: Dispatch<SetStateAction<DailyExerciseItem[]>>
  setTasks: Dispatch<SetStateAction<CustomTask[]>>
  setRoutines: Dispatch<SetStateAction<RoutineTask[]>>
}

const NO_CONTENT = {
  meals: [] as DailyMeal[],
  mealItems: [] as DailyMealItem[],
  supplements: [] as DailySupplement[],
  exerciseItems: [] as DailyExerciseItem[],
  tasks: [] as CustomTask[],
  routines: [] as RoutineTask[],
}

/**
 * 按业务日期加载当天计划及其从属内容。
 *
 * 只负责读取：补剂实例的「进面板时补齐」属于写入，放在打开面板时做，
 * 这样读路径保持无副作用，历史日期也不会因为打开页面被改写。
 */
export function useDayPlanData(selectedDate: string, enabled = true): DayPlanData {
  const [plan, setPlan] = useState<DayPlan | null>(null)
  const [meals, setMeals] = useState<DailyMeal[]>(NO_CONTENT.meals)
  const [mealItems, setMealItems] = useState<DailyMealItem[]>(NO_CONTENT.mealItems)
  const [supplements, setSupplements] = useState<DailySupplement[]>(NO_CONTENT.supplements)
  const [exerciseItems, setExerciseItems] = useState<DailyExerciseItem[]>(NO_CONTENT.exerciseItems)
  const [tasks, setTasks] = useState<CustomTask[]>(NO_CONTENT.tasks)
  const [routines, setRoutines] = useState<RoutineTask[]>(NO_CONTENT.routines)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLoading(true)
      setPlan(null)
      setMeals(NO_CONTENT.meals)
      setMealItems(NO_CONTENT.mealItems)
      setSupplements(NO_CONTENT.supplements)
      setExerciseItems(NO_CONTENT.exerciseItems)
      setTasks(NO_CONTENT.tasks)
      setRoutines(NO_CONTENT.routines)
      setLoadError(null)
      return
    }
    let active = true
    const context = captureAuthContext()
    const current = () => active && isAuthContextCurrent(context)
    const load = async (): Promise<void> => {
      let nextPlan = await getDayPlan(selectedDate)
      if (!current()) return

      // 正常休息日自动补齐家务；每次等待后确认日期和账号上下文仍然有效。
      const mode = nextPlan?.mode ?? defaultModeForDate(selectedDate)
      if (!isHistorical(selectedDate) && mode === 'rest' && nextPlan?.mode_override !== true) {
        if (!nextPlan) {
          nextPlan = await upsertDayPlan(selectedDate, { mode: 'rest', mode_override: false })
          if (!current()) return
        }
        await ensureRestDayRoutines(selectedDate)
        if (!current()) return
      }

      setPlan(nextPlan)
      if (!nextPlan) {
        setMeals(NO_CONTENT.meals)
        setMealItems(NO_CONTENT.mealItems)
        setSupplements(NO_CONTENT.supplements)
        setExerciseItems(NO_CONTENT.exerciseItems)
        setTasks(NO_CONTENT.tasks)
        setRoutines(NO_CONTENT.routines)
        return
      }
      const [nextMeals, nextMealItems, nextSupplements, nextExerciseItems, nextTasks, nextRoutines] = await Promise.all([
        listMeals(nextPlan.id),
        listMealItems(nextPlan.id),
        listDaySupplements(nextPlan.id),
        listExerciseItems(nextPlan.id),
        listCustomTasks(nextPlan.id),
        listRoutineTasks(nextPlan.id),
      ])
      if (!current()) return
      setMeals(nextMeals)
      setMealItems(nextMealItems)
      setSupplements(nextSupplements)
      setExerciseItems(nextExerciseItems)
      setTasks(nextTasks)
      setRoutines(nextRoutines)
    }
    setLoading(true)
    setLoadError(null)
    void load()
      .catch((reason: unknown) => {
        if (current()) setLoadError(describeDataError(reason))
      })
      .finally(() => {
        if (current()) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedDate, enabled])

  return {
    plan,
    meals,
    mealItems,
    supplements,
    exerciseItems,
    tasks,
    routines,
    loading,
    loadError,
    setPlan,
    setMeals,
    setMealItems,
    setSupplements,
    setExerciseItems,
    setTasks,
    setRoutines,
  }
}
