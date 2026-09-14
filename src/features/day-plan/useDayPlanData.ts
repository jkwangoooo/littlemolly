import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  CustomTask,
  DailyExerciseItem,
  DailyMeal,
  DailyMealItem,
  DailySupplement,
  DayPlan,
} from '../../shared/types/dayPlan'
import { describeDataError } from '../../shared/errors'
import {
  getDayPlan,
  listCustomTasks,
  listDaySupplements,
  listExerciseItems,
  listMealItems,
  listMeals,
} from '../../services/local/dayPlanService'

export type DayPlanData = {
  plan: DayPlan | null
  meals: DailyMeal[]
  mealItems: DailyMealItem[]
  supplements: DailySupplement[]
  exerciseItems: DailyExerciseItem[]
  tasks: CustomTask[]
  loading: boolean
  loadError: string | null
  setPlan: Dispatch<SetStateAction<DayPlan | null>>
  setMeals: Dispatch<SetStateAction<DailyMeal[]>>
  setMealItems: Dispatch<SetStateAction<DailyMealItem[]>>
  setSupplements: Dispatch<SetStateAction<DailySupplement[]>>
  setExerciseItems: Dispatch<SetStateAction<DailyExerciseItem[]>>
  setTasks: Dispatch<SetStateAction<CustomTask[]>>
}

const NO_CONTENT = {
  meals: [] as DailyMeal[],
  mealItems: [] as DailyMealItem[],
  supplements: [] as DailySupplement[],
  exerciseItems: [] as DailyExerciseItem[],
  tasks: [] as CustomTask[],
}

/**
 * 按业务日期加载当天计划及其从属内容。
 *
 * 只负责读取：补剂实例的「进面板时补齐」属于写入，放在打开面板时做，
 * 这样读路径保持无副作用，历史日期也不会因为打开页面被改写。
 */
export function useDayPlanData(selectedDate: string): DayPlanData {
  const [plan, setPlan] = useState<DayPlan | null>(null)
  const [meals, setMeals] = useState<DailyMeal[]>(NO_CONTENT.meals)
  const [mealItems, setMealItems] = useState<DailyMealItem[]>(NO_CONTENT.mealItems)
  const [supplements, setSupplements] = useState<DailySupplement[]>(NO_CONTENT.supplements)
  const [exerciseItems, setExerciseItems] = useState<DailyExerciseItem[]>(NO_CONTENT.exerciseItems)
  const [tasks, setTasks] = useState<CustomTask[]>(NO_CONTENT.tasks)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const nextPlan = await getDayPlan(selectedDate)
    setPlan(nextPlan)
    if (!nextPlan) {
      setMeals(NO_CONTENT.meals)
      setMealItems(NO_CONTENT.mealItems)
      setSupplements(NO_CONTENT.supplements)
      setExerciseItems(NO_CONTENT.exerciseItems)
      setTasks(NO_CONTENT.tasks)
      return
    }
    const [nextMeals, nextMealItems, nextSupplements, nextExerciseItems, nextTasks] = await Promise.all([
      listMeals(nextPlan.id),
      listMealItems(nextPlan.id),
      listDaySupplements(nextPlan.id),
      listExerciseItems(nextPlan.id),
      listCustomTasks(nextPlan.id),
    ])
    setMeals(nextMeals)
    setMealItems(nextMealItems)
    setSupplements(nextSupplements)
    setExerciseItems(nextExerciseItems)
    setTasks(nextTasks)
  }, [selectedDate])

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)
    void load()
      .catch((reason: unknown) => {
        if (active) setLoadError(describeDataError(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [load])

  return {
    plan,
    meals,
    mealItems,
    supplements,
    exerciseItems,
    tasks,
    loading,
    loadError,
    setPlan,
    setMeals,
    setMealItems,
    setSupplements,
    setExerciseItems,
    setTasks,
  }
}
