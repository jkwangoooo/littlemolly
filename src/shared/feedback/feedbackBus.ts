import type { DomainFeedbackEvent, FeedbackListener } from './feedbackTypes'

const listeners = new Set<FeedbackListener>()
const consumedActionIds = new Set<string>()

/**
 * 发布一次已经发生的业务反馈事件。
 * actionId 是一次用户动作的幂等键；同一动作不会被重复消费。
 */
export function publishFeedback(event: DomainFeedbackEvent): boolean {
  if (consumedActionIds.has(event.actionId)) return false
  consumedActionIds.add(event.actionId)
  listeners.forEach((listener) => listener(event))
  return true
}

export function subscribeFeedback(listener: FeedbackListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 页面导航或退出登录时清理旧动作，避免旧事件污染新上下文。 */
export function resetFeedbackActions(): void {
  consumedActionIds.clear()
}
