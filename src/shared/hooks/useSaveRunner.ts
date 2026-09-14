import { useCallback, useRef, useState } from 'react'
import type { SaveStatus } from '../types/save'
import { describeDataError } from '../errors'

export type SaveRunner = {
  status: SaveStatus
  saveError: string | null
  canRetry: boolean
  runSave: (action: () => Promise<void>) => Promise<void>
  retryLastSave: () => Promise<void>
  /** 切换日期时调用：丢弃上一次的待重试请求与错误提示，并把状态文案回到「尚未修改」。 */
  resetForDateChange: () => void
}

/**
 * 本地保存状态机。所有写入都经 runSave：保存中 → 已保存 / 保存失败，
 * 失败时保留最后一次完整请求，供界面上的「重试」原样重发。
 */
export function useSaveRunner(): SaveRunner {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const retryRef = useRef<(() => Promise<void>) | null>(null)

  const runSave = useCallback(async (action: () => Promise<void>) => {
    retryRef.current = action
    setStatus('saving')
    setSaveError(null)
    try {
      await action()
      setStatus('saved')
      retryRef.current = null
    } catch (reason) {
      setStatus('error')
      setSaveError(describeDataError(reason))
    }
  }, [])

  const retryLastSave = useCallback(async () => {
    if (retryRef.current) await runSave(retryRef.current)
  }, [runSave])

  // 同时把状态文案归零：否则在 A 日期保存完再切到空白的 B 日期，顶部会显示「已保存」，
  // 让人以为 B 日期也有内容。这里只改文案，不产生任何写入。
  const resetForDateChange = useCallback(() => {
    retryRef.current = null
    setSaveError(null)
    setStatus('idle')
  }, [])

  return { status, saveError, canRetry: retryRef.current !== null, runSave, retryLastSave, resetForDateChange }
}
