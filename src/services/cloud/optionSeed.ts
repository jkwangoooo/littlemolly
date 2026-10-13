import { EXAMPLE_EXERCISES, EXAMPLE_FOODS, EXAMPLE_SUPPLEMENTS } from '../optionExamples'
import { throwSupabaseError } from './errors'
import { requireSupabase } from './supabase'

/**
 * 示例选项种子数据（Supabase 实现，L6）。
 *
 * 与 `local/optionSeed.ts` 等价：幂等（按名称去重后只补缺失）、
 * `sort_order` 从已有条数往后排、「载入示例选项」与注册时播种共用这一个入口。
 * 示例内容本身取自 `services/optionExamples.ts`，两边共用同一份清单。
 */

/** 三类选项表的名称，避免三处重复写字符串。 */
type OptionTable = 'food_options' | 'supplement_templates' | 'exercise_options'

async function existingNames(table: OptionTable, userId: string): Promise<Set<string>> {
  const { data, error } = await requireSupabase().from(table).select('name').eq('user_id', userId)
  if (error) throwSupabaseError(error)
  return new Set(((data ?? []) as Array<{ name: string }>).map((row) => row.name))
}

async function insertRows(
  table: OptionTable,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (!rows.length) return
  const { error } = await requireSupabase().from(table).insert(rows)
  if (error) throwSupabaseError(error)
}

export async function seedExampleOptions(userId: string): Promise<void> {
  const foodNames = await existingNames('food_options', userId)
  await insertRows(
    'food_options',
    EXAMPLE_FOODS.filter((name) => !foodNames.has(name)).map((name, index) => ({
      user_id: userId,
      name,
      active: true,
      sort_order: foodNames.size + index,
    })),
  )

  const supplementNames = await existingNames('supplement_templates', userId)
  await insertRows(
    'supplement_templates',
    EXAMPLE_SUPPLEMENTS.filter((example) => !supplementNames.has(example.name)).map((example, index) => ({
      user_id: userId,
      name: example.name,
      period: example.period,
      active: true,
      sort_order: supplementNames.size + index,
    })),
  )

  const exerciseNames = await existingNames('exercise_options', userId)
  await insertRows(
    'exercise_options',
    EXAMPLE_EXERCISES.filter((name) => !exerciseNames.has(name)).map((name, index) => ({
      user_id: userId,
      name,
      active: true,
      sort_order: exerciseNames.size + index,
    })),
  )
}
