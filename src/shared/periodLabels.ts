import type { SupplementPeriod } from './types/options'

/**
 * 补剂时段文案。选项页与日计划页都要用，放 shared 里保证只有一份。
 * 顺序由 `SUPPLEMENT_PERIODS` 定义，这里只负责中文名。
 */
export const SUPPLEMENT_PERIOD_LABEL: Record<SupplementPeriod, string> = {
  morning: '早',
  noon: '中',
  evening: '晚',
}
