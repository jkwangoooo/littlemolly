import type { SupplementPeriod } from '../shared/types/options'

/**
 * 示例选项内容（L6 抽出）。
 *
 * 放在后端无关的位置，是因为本地与云端两套适配器都要给新账号播种同一批示例，
 * 内容必须只有一份——否则两边的示例清单会慢慢分叉，同一份数据在两种后端下长得不一样。
 *
 * 这里只有数据，没有写入逻辑：本地写在 `local/optionSeed.ts`（IndexedDB），
 * 云端写在 `cloud/optionSeed.ts`（Supabase）。页面不得引用本文件，
 * `scripts/check-local-data.mjs` 会断言界面层没有写死这里面的任何名称。
 */

export const EXAMPLE_FOODS = ['燕麦牛奶', '水煮蛋', '鸡胸沙拉', '番茄鸡蛋面', '清炒时蔬']

export const EXAMPLE_SUPPLEMENTS: Array<{ name: string; period: SupplementPeriod }> = [
  { name: '维生素 D', period: 'morning' },
  { name: '鱼油', period: 'noon' },
  { name: '钙片', period: 'evening' },
]

export const EXAMPLE_EXERCISES = ['快走', '瑜伽', '力量训练', '拉伸']
