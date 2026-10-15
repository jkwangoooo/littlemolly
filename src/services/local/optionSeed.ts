import type { ExerciseOption, FoodOption, SupplementTemplate } from '../../shared/types/options'
import { EXAMPLE_EXERCISES, EXAMPLE_FOODS, EXAMPLE_SUPPLEMENTS } from '../optionExamples'
import { assertAuthContextCurrent, captureAuthContext } from '../session'
import { atomicReadWrite, newId, type TransactionWork } from './localDb'

/**
 * 示例选项种子数据（本地实现）。
 *
 * 放在服务层而不是页面里：页面只调用 `seedExampleOptions()`，不持有任何默认清单，
 * 这样以后调整示例内容不需要动界面代码。清单本身在 `services/optionExamples.ts`。
 */

function now(): string {
  return new Date().toISOString()
}

/**
 * 为已经认证且准备好的账号补齐示例选项。
 *
 * 幂等：按名称去重后只补缺失项，重复调用不会产生重复记录，
 * 所有类别在同一个事务中补齐并记队列，首次云端恢复前不能调用。
 */
export async function seedExampleOptions(userId: string): Promise<void> {
  const context = captureAuthContext()
  if (context.owner !== userId) throw new Error('示例选项只能载入当前账号。')
  await atomicReadWrite({
    stores: ['food_options', 'supplement_templates', 'exercise_options'],
    owner: context.owner,
    guard: () => assertAuthContextCurrent(context),
    read: async (reader) => {
      const [foods, supplements, exercises] = await Promise.all([
        reader.getAll<FoodOption>('food_options'),
        reader.getAll<SupplementTemplate>('supplement_templates'),
        reader.getAll<ExerciseOption>('exercise_options'),
      ])
      return {
        foods: foods.filter((row) => row.user_id === userId),
        supplements: supplements.filter((row) => row.user_id === userId),
        exercises: exercises.filter((row) => row.user_id === userId),
      }
    },
    build: ({ foods, supplements, exercises }) => {
      const timestamp = now()
      const puts: NonNullable<TransactionWork['put']> = []
      const existingFoods = new Set(foods.map((row) => row.name))
      let foodOrder = foods.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1
      for (const name of EXAMPLE_FOODS) {
        if (existingFoods.has(name)) continue
        puts.push({ store: 'food_options', value: {
          id: newId(), user_id: userId, name, active: true, sort_order: foodOrder++,
          created_at: timestamp, updated_at: timestamp,
        } as FoodOption })
      }
      const existingSupplements = new Set(supplements.map((row) => `${row.period}:${row.name}`))
      let supplementOrder = supplements.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1
      for (const example of EXAMPLE_SUPPLEMENTS) {
        if (existingSupplements.has(`${example.period}:${example.name}`)) continue
        puts.push({ store: 'supplement_templates', value: {
          id: newId(), user_id: userId, name: example.name, period: example.period, active: true,
          sort_order: supplementOrder++, created_at: timestamp, updated_at: timestamp,
        } as SupplementTemplate })
      }
      const existingExercises = new Set(exercises.map((row) => row.name))
      let exerciseOrder = exercises.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1
      for (const name of EXAMPLE_EXERCISES) {
        if (existingExercises.has(name)) continue
        puts.push({ store: 'exercise_options', value: {
          id: newId(), user_id: userId, name, active: true, sort_order: exerciseOrder++,
          created_at: timestamp, updated_at: timestamp,
        } as ExerciseOption })
      }
      return { put: puts }
    },
  })
}
