import type { DateRelation } from '../date/dateUtils'

export type DomainFeedbackEvent =
  | {
      type: 'day-mode-changed'
      actionId: string
      date: string
      from: 'work' | 'rest'
      to: 'work' | 'rest'
      relation: DateRelation
      localSaved: true
    }
  | {
      type: 'completion'
      actionId: string
      date: string
      text: string
    }
  | {
      type: 'save-failed'
      actionId: string
      scope: 'day-plan' | 'task' | 'backup'
      message: string
    }

export type FeedbackListener = (event: DomainFeedbackEvent) => void
