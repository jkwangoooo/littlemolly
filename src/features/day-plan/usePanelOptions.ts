import { useEffect, useState } from 'react'
import type { ExerciseOption, FoodOption, SupplementTemplate } from '../../shared/types/options'
import { describeDataError } from '../../shared/errors'
import { listSelectableOptions } from '../../services/local/optionService'

export type PanelOptions = {
  food: FoodOption[]
  supplement: SupplementTemplate[]
  exercise: ExerciseOption[]
  loading: boolean
  error: string | null
}

const INITIAL: PanelOptions = { food: [], supplement: [], exercise: [], loading: true, error: null }

/**
 * 编辑面板的候选项。统一走 `listSelectableOptions`——它是 L2 选择器的唯一数据来源，
 * 停用中的选项天然不会出现在这里（docs/05 L1 验收的口径）。
 *
 * 三类一起取：面板是按需打开的，一次取齐比每次打开再判断取哪类更省分支。
 */
export function usePanelOptions(active: boolean): PanelOptions {
  const [options, setOptions] = useState<PanelOptions>(INITIAL)

  useEffect(() => {
    if (!active) return
    let alive = true
    setOptions((current) => ({ ...current, loading: true, error: null }))

    void Promise.all([
      listSelectableOptions('food'),
      listSelectableOptions('supplement'),
      listSelectableOptions('exercise'),
    ])
      .then(([food, supplement, exercise]) => {
        if (alive) setOptions({ food, supplement, exercise, loading: false, error: null })
      })
      .catch((reason: unknown) => {
        if (alive) setOptions({ food: [], supplement: [], exercise: [], loading: false, error: describeDataError(reason) })
      })

    return () => {
      alive = false
    }
  }, [active])

  return options
}
