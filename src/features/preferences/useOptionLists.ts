<<<<<<< HEAD
import { useCallback, useEffect, useRef, useState } from 'react'
import { captureAuthContext, isAuthContextCurrent } from '../../services/api/authService'
=======
import { useCallback, useEffect, useState } from 'react'
>>>>>>> origin/main
import type { ExerciseOption, FoodOption, SupplementTemplate } from '../../shared/types/options'
import { describeDataError } from '../../shared/errors'
import { listOptions, listSelectableOptions } from '../../services/api/optionService'

export type OptionLists = {
  food: FoodOption[]
  supplement: SupplementTemplate[]
  exercise: ExerciseOption[]
}

/** 每个分区「新计划里会出现几项」。取自 L2 选择器要用的那个 API，而不是另算一遍。 */
export type SelectableCounts = {
  food: number
  supplement: number
  exercise: number
}

const EMPTY: OptionLists = { food: [], supplement: [], exercise: [] }
const NO_COUNTS: SelectableCounts = { food: 0, supplement: 0, exercise: 0 }

/**
<<<<<<< HEAD
 * 读取三类选项清单。每次切换子屏时重读，每次写入后由调用方 await reload()，
=======
 * 读取三类选项清单。每次写入后由调用方 await reload()，
>>>>>>> origin/main
 * 与日计划页的做法一致：写走服务层，读回填状态，hook 不承担保存语义。
 *
 * 同时读取「启用中」的数量，用的就是 L2 选择器将要调用的 `listSelectableOptions`，
 * 因此页面上显示的可用数量与选择器将来的行为同源，不会出现两套判定。
 */
<<<<<<< HEAD
export function useOptionLists(view: string): {
=======
export function useOptionLists(): {
>>>>>>> origin/main
  lists: OptionLists
  selectable: SelectableCounts
  loading: boolean
  loadError: string | null
  reload: () => Promise<void>
} {
  const [lists, setLists] = useState<OptionLists>(EMPTY)
  const [selectable, setSelectable] = useState<SelectableCounts>(NO_COUNTS)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
<<<<<<< HEAD
  const mounted = useRef(false)
  const revision = useRef(0)

  const reload = useCallback(async () => {
    const context = captureAuthContext()
    const request = ++revision.current
=======

  const reload = useCallback(async () => {
>>>>>>> origin/main
    const [food, supplement, exercise, selectableFood, selectableSupplement, selectableExercise] = await Promise.all([
      listOptions('food'),
      listOptions('supplement'),
      listOptions('exercise'),
      listSelectableOptions('food'),
      listSelectableOptions('supplement'),
      listSelectableOptions('exercise'),
    ])
<<<<<<< HEAD
    if (!mounted.current || request !== revision.current || !isAuthContextCurrent(context)) return
=======
>>>>>>> origin/main
    setLists({ food, supplement, exercise })
    setSelectable({
      food: selectableFood.length,
      supplement: selectableSupplement.length,
      exercise: selectableExercise.length,
    })
  }, [])

  useEffect(() => {
    let active = true
<<<<<<< HEAD
    const context = captureAuthContext()
    mounted.current = true
    setLoading(true)
    setLoadError(null)
    void reload()
      .catch((reason: unknown) => {
        if (active && isAuthContextCurrent(context)) setLoadError(describeDataError(reason))
      })
      .finally(() => {
        if (active && isAuthContextCurrent(context)) setLoading(false)
      })
    return () => {
      active = false
      mounted.current = false
      revision.current += 1
    }
  }, [reload, view])
=======
    void reload()
      .catch((reason: unknown) => {
        if (active) setLoadError(describeDataError(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [reload])
>>>>>>> origin/main

  return { lists, selectable, loading, loadError, reload }
}
