export const BUSINESS_TIME_ZONE = 'Asia/Shanghai'

export type DateRelation = 'today' | 'tomorrow' | 'future' | 'history'

function partsToDateKey(parts: Intl.DateTimeFormatPart[]): string {
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function getBusinessDateKey(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return partsToDateKey(formatter.formatToParts(date))
}

export function parseDateKey(dateKey: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) throw new Error(`Invalid date key: ${dateKey}`)
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (date.toISOString().slice(0, 10) !== dateKey) throw new Error(`Invalid date key: ${dateKey}`)
  return date
}

export function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(dateKey: string, amount: number): string {
  const date = parseDateKey(dateKey)
  date.setUTCDate(date.getUTCDate() + amount)
  return formatDateKey(date)
}

export function dayOfWeekMondayFirst(dateKey: string): number {
  const sundayFirst = parseDateKey(dateKey).getUTCDay()
  return sundayFirst === 0 ? 6 : sundayFirst - 1
}

export function getMonday(dateKey: string): string {
  return addDays(dateKey, -dayOfWeekMondayFirst(dateKey))
}

export function getWeekDates(dateKey: string): string[] {
  const monday = getMonday(dateKey)
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

export function defaultModeForDate(dateKey: string): 'work' | 'rest' {
  return dayOfWeekMondayFirst(dateKey) < 5 ? 'work' : 'rest'
}

export function classifyDate(dateKey: string, today = getBusinessDateKey()): DateRelation {
  if (dateKey < today) return 'history'
  if (dateKey === today) return 'today'
  if (dateKey === addDays(today, 1)) return 'tomorrow'
  return 'future'
}

export const isToday = (dateKey: string, today = getBusinessDateKey()) => classifyDate(dateKey, today) === 'today'
export const isTomorrow = (dateKey: string, today = getBusinessDateKey()) => classifyDate(dateKey, today) === 'tomorrow'
export const isFuture = (dateKey: string, today = getBusinessDateKey()) => classifyDate(dateKey, today) === 'future'
export const isHistorical = (dateKey: string, today = getBusinessDateKey()) => classifyDate(dateKey, today) === 'history'
export const getWeekStart = getMonday

export function formatDateLabel(dateKey: string): string {
  const date = parseDateKey(dateKey)
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: 'long', day: 'numeric' }).format(date)
}

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
