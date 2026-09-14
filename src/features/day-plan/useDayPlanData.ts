import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { CustomTask, DailyMeal, DayPlan } from '../../shared/types/dayPlan'
import { describeDataError } from '../../shared/errors'
import { getDayPlan, listCustomTasks, listMeals } from '../../services/local/dayPlanService'

export type DayPlanData = {
  plan: DayPlan | null
  meals: DailyMeal[]
  tasks: CustomTask[]
  loading: boolean
  loadError: string | null
  setPlan: Dispatch<SetStateAction<DayPlan | null>>
  setMeals: Dispatch<SetStateAction<DailyMeal[]>>
  setTasks: Dispatch<SetStateAction<CustomTask[]>>
}

/**
 * 按业务日期加载当天计划及其从属内容。
 * 只负责读取；写入由调用方通过服务层完成后再回填状态，避免这里承担保存语义。
 */
export function useDayPlanData(selectedDate: string): DayPlanData {
  const [plan, setPlan] = useState<DayPlan | null>(null)
  const [meals, setMeals] = useState<DailyMeal[]>([])
  const [tasks, setTasks] = useState<CustomTask[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)

    void getDayPlan(selectedDate)
      .then(async (nextPlan) => {
        if (!active) return
        setPlan(nextPlan)
        if (!nextPlan) {
          setMeals([])
          setTasks([])
          return
        }
        const [nextMeals, nextTasks] = await Promise.all([listMeals(nextPlan.id), listCustomTasks(nextPlan.id)])
        if (!active) return
        setMeals(nextMeals)
        setTasks(nextTasks)
      })
      .catch((reason: unknown) => {
        if (active) setLoadError(describeDataError(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [selectedDate])

  return { plan, meals, tasks, loading, loadError, setPlan, setMeals, setTasks }
}