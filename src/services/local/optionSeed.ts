import type { ExerciseOption, FoodOption, SupplementPeriod, SupplementTemplate } from '../../shared/types/options'
import { getAll, newId, put } from './localDb'

/**
 * 示例选项种子数据。
 *
 * 放在服务层而不是页面里：页面只调用 `seedExampleOptions()`，不持有任何默认清单，
 * 这样以后调整示例内容不需要动界面代码，也方便 L6 迁移时换成服务端下发。
 */

const EXAMPLE_FOODS = ['燕麦牛奶', '水煮蛋', '鸡胸沙拉', '番茄鸡蛋面', '清炒时蔬']

const EXAMPLE_SUPPLEMENTS: Array<{ name: string; period: SupplementPeriod }> = [
  { name: '维生素 D', period: 'morning' },
  { name: '鱼油', period: 'noon' },
  { name: '钙片', period: 'evening' },
]

const EXAMPLE_EXERCISES = ['快走', '瑜伽', '力量训练', '拉伸']

function now(): string {
  return new Date().toISOString()
}

/**
 * 为新账号写入示例选项。
 *
 * 幂等：按名称去重后只补缺失项，重复调用不会产生重复记录，
 * 因此「载入示例选项」按钮和注册时的自动播种可以安全共用同一个入口。
 * 只按仓库名与 userId 操作，不依赖 authService，避免与它形成循环依赖。
 */
export async function seedExampleOptions(userId: string): Promise<void> {
  const timestamp = now()

  const existingFoods = new Set((await getAll<FoodOption>('food_options')).filter((item) => item.user_id === userId).map((item) => item.name))
  let foodOrder = existingFoods.size
  for (const name of EXAMPLE_FOODS) {
    if (existingFoods.has(name)) continue
    await put<FoodOption>('food_options', { id: newId(), user_id: userId, name, active: true, sort_order: foodOrder, created_at: timestamp, updated_at: timestamp })
    foodOrder += 1
  }

  const existingSupplements = new Set(
    (await getAll<SupplementTemplate>('supplement_templates')).filter((item) => item.user_id === userId).map((item) => item.name),
  )
  let supplementOrder = existingSupplements.size
  for (const example of EXAMPLE_SUPPLEMENTS) {
    if (existingSupplements.has(example.name)) continue
    await put<SupplementTemplate>('supplement_templates', {
      id: newId(), user_id: userId, name: example.name, period: example.period, active: true, sort_order: supplementOrder, created_at: timestamp, updated_at: timestamp,
    })
    supplementOrder += 1
  }

  const existingExercises = new Set(
    (await getAll<ExerciseOption>('exercise_options')).filter((item) => item.user_id === userId).map((item) => item.name),
  )
  let exerciseOrder = existingExercises.size
  for (const name of EXAMPLE_EXERCISES) {
    if (existingExercises.has(name)) continue
    await put<ExerciseOption>('exercise_options', { id: newId(), user_id: userId, name, active: true, sort_order: exerciseOrder, created_at: timestamp, updated_at: timestamp })
    exerciseOrder += 1
  }
}
