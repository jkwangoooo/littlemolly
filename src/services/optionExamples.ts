import type { SupplementPeriod } from '../shared/types/options'

/**
 * 示例选项内容（L6 抽出）。
 *
 * 放在后端无关的位置，是因为**播种**要给新账号一批示例，内容必须只有一份。
 * L6 时本地与云端两套适配器各播一份，所以要强调「两侧不能分叉」；
 * **S4-T7 删掉云端适配器后只剩本地播种一处消费者**，但这条纪律不变：
 * 内容是数据，播种是逻辑，数据不进 `local/`。
 *
 * 这里只有数据，没有写入逻辑：唯一的消费者是 `local/optionSeed.ts`（IndexedDB）。
 * 页面不得引用本文件，`scripts/check-local-data.mjs` 会断言界面层没有写死这里面的任何名称。
 */

export const EXAMPLE_FOODS = ['燕麦牛奶', '水煮蛋', '鸡胸沙拉', '番茄鸡蛋面', '清炒时蔬']

export const EXAMPLE_SUPPLEMENTS: Array<{ name: string; period: SupplementPeriod }> = [
  { name: '维生素 D', period: 'morning' },
  { name: '鱼油', period: 'noon' },
  { name: '钙片', period: 'evening' },
]

export const EXAMPLE_EXERCISES = ['快走', '瑜伽', '力量训练', '拉伸']
