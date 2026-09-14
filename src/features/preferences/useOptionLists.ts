import { useCallback, useEffect, useState } from 'react'
import type { ExerciseOption, FoodOption, SupplementTemplate } from '../../shared/types/options'
import { describeDataError } from '../../shared/errors'
import { listOptions, listSelectableOptions } from '../../services/local/optionService'

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
 * 读取三类选项清单。每次写入后由调用方 await reload()，
 * 与日计划页的做法一致：写走服务层，读回填状态，hook 不承担保存语义。
 *
 * 同时读取「启用中」的数量，用的就是 L2 选择器将要调用的 `listSelectableOptions`，
 * 因此页面上显示的可用数量与选择器将来的行为同源，不会出现两套判定。
 */
export function useOptionLists(): {
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

  const reload = useCallback(async () => {
    const [food, supplement, exercise, selectableFood, selectableSupplement, selectableExercise] = await Promise.all([
      listOptions('food'),
      listOptions('supplement'),
      listOptions('exercise'),
      listSelectableOptions('food'),
      listSelectableOptions('supplement'),
      listSelectableOptions('exercise'),
    ])
    setLists({ food, supplement, exercise })
    setSelectable({
      food: selectableFood.length,
      supplement: selectableSupplement.length,
      exercise: selectableExercise.length,
    })
  }, [])

  useEffect(() => {
    let active = true
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

  return { lists, selectable, loading, loadError, reload }
}
