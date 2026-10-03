import { useEffect, useRef, useState } from 'react'
import {
  HolidayCelebration
} from '../components/HolidayCelebration'
import { PetMessageBubble, type PetMessage, type PetPosition } from '../components/PetMessageBubble'
import { subscribeFeedback } from './feedbackBus'
import { shouldConsumeFeedback } from './feedbackPolicy'

type FeedbackHostProps = {
  selectedDate: string
  optionsOpen: boolean
  onCelebrationChange?: (open: boolean) => void
  petPosition: PetPosition | null
  petViewport: { width: number; height: number; offsetLeft: number; offsetTop: number }
}

/**
 * 统一承载跨业务反馈的表现层。它只消费已经发生的反馈事件，不读写业务数据。
 * 第一阶段先迁移模式切换庆祝和宠物消息；普通完成提示仍由日计划页管理。
 */
export function FeedbackHost({
  selectedDate,
  optionsOpen,
  onCelebrationChange,
  petPosition,
  petViewport,
}: FeedbackHostProps) {
  const [celebration, setCelebration] = useState<{ headline: string } | null>(null)
  const [completionText, setCompletionText] = useState('')
  const [errorText, setErrorText] = useState('')
  const [petMessage, setPetMessage] = useState<PetMessage | null>(null)
  const petMessageIdRef = useRef(0)
  const celebrationActiveRef = useRef(false)
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return subscribeFeedback((event) => {
      if (!shouldConsumeFeedback(event, selectedDate, optionsOpen, celebrationActiveRef.current)) return
      if (event.type === 'save-failed') {
        if (completionTimerRef.current) clearTimeout(completionTimerRef.current)
        setCompletionText('')
        setErrorText('本地保存失败：' + event.message)
        return
      }
      if (event.type === 'completion') {
        if (celebrationActiveRef.current) return
        setCompletionText(event.text)
        if (completionTimerRef.current) clearTimeout(completionTimerRef.current)
        completionTimerRef.current = setTimeout(() => setCompletionText(''), 2100)
        return
      }
      if (event.type !== 'day-mode-changed' || event.from !== 'work' || event.to !== 'rest') return
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current)
      setCompletionText('')
      celebrationActiveRef.current = true
      setCelebration({ headline: event.relation === 'today' ? '今天不上班' : '这一天不上班' })
      petMessageIdRef.current += 1
      setPetMessage({
        id: petMessageIdRef.current,
        title: '今天就放慢一点',
        text: '安排已经切换为休息日，给自己留一点从容。',
      })
    })
  }, [optionsOpen, selectedDate])

  useEffect(() => {
    return () => {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (optionsOpen) {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current)
      setCompletionText('')
      setErrorText('')
    }
  }, [optionsOpen])

  useEffect(() => {
    if (completionTimerRef.current) clearTimeout(completionTimerRef.current)
    setCompletionText('')
    setErrorText('')
    celebrationActiveRef.current = false
    setCelebration(null)
    setPetMessage(null)
  }, [selectedDate])

  useEffect(() => {
    onCelebrationChange?.(celebration !== null)
  }, [celebration, onCelebrationChange])

  function closeCelebration() {
    celebrationActiveRef.current = false
    setCelebration(null)
  }

  return (
    <>
      {errorText ? <p className="feedback-error" role="alert">{errorText}</p> : null}
      <p className={`completion-feedback${completionText ? ' visible' : ''}`} aria-live="polite">
        {completionText}
      </p>
      <PetMessageBubble message={petMessage} position={petPosition} viewport={petViewport} />
      <HolidayCelebration
        open={celebration !== null}
        headline={celebration?.headline ?? ''}
        fromLabel="工作日"
        toLabel="休息日"
        onClose={closeCelebration}
      />
    </>
  )
}
