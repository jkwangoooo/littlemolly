import type { DomainFeedbackEvent } from './feedbackTypes'

export type FeedbackPriority = 'critical' | 'high' | 'normal' | 'low'

export type FeedbackDecision = {
  priority: FeedbackPriority
  channel: 'error' | 'celebration' | 'completion' | 'silent'
  interruptible: boolean
}

export function feedbackPriority(event: DomainFeedbackEvent): FeedbackPriority {
  if (event.type === 'save-failed') return 'critical'
  if (event.type === 'day-mode-changed' && event.from === 'work' && event.to === 'rest') return 'high'
  if (event.type === 'completion') return 'normal'
  return 'low'
}

export function feedbackDecision(event: DomainFeedbackEvent): FeedbackDecision {
  if (event.type === 'save-failed') {
    return { priority: 'critical', channel: 'error', interruptible: true }
  }
  if (event.type === 'day-mode-changed' && event.from === 'work' && event.to === 'rest') {
    return { priority: 'high', channel: 'celebration', interruptible: false }
  }
  if (event.type === 'completion') {
    return { priority: 'normal', channel: 'completion', interruptible: false }
  }
  return { priority: 'low', channel: 'silent', interruptible: false }
}

export function isFeedbackForDate(event: DomainFeedbackEvent, selectedDate: string): boolean {
  return event.type === 'save-failed' || event.date === selectedDate
}

export function shouldConsumeFeedback(
  event: DomainFeedbackEvent,
  selectedDate: string,
  optionsOpen: boolean,
  celebrationActive: boolean,
): boolean {
  if (optionsOpen || !isFeedbackForDate(event, selectedDate)) return false
  const decision = feedbackDecision(event)
  if (decision.channel === 'completion' && celebrationActive) return false
  return decision.channel !== 'silent'
}
