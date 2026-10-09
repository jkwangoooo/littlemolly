import { useEffect, useRef, useState } from 'react'
import { HolidayCelebration } from '../components/HolidayCelebration'
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

/** 统一承载跨业务反馈；完成反馈通过小猴头部附近的消息气泡呈现。 */
export function FeedbackHost({ selectedDate, optionsOpen, onCelebrationChange, petPosition, petViewport }: FeedbackHostProps) {
  const [celebration, setCelebration] = useState<{ headline: string } | null>(null)
  const [errorText, setErrorText] = useState('')
  const [petMessage, setPetMessage] = useState<PetMessage | null>(null)
  const petMessageIdRef = useRef(0)
  const celebrationActiveRef = useRef(false)

  useEffect(() => subscribeFeedback((event) => {
    if (!shouldConsumeFeedback(event, selectedDate, optionsOpen, celebrationActiveRef.current)) return
    if (event.type === 'save-failed') {
      setErrorText('本地保存失败：' + event.message)
      return
    }
    if (event.type === 'completion') {
      if (celebrationActiveRef.current) return
      petMessageIdRef.current += 1
      setPetMessage({ id: petMessageIdRef.current, title: '完成啦', text: event.text })
      return
    }
    if (event.type !== 'day-mode-changed' || event.from !== 'work' || event.to !== 'rest') return
    celebrationActiveRef.current = true
    setCelebration({ headline: event.relation === 'today' ? '今天不上班' : '这一天不上班' })
    petMessageIdRef.current += 1
    setPetMessage({ id: petMessageIdRef.current, title: '今天就放慢一点', text: '安排已经切换为休息日，给自己留一点从容。' })
  }), [optionsOpen, selectedDate])

  useEffect(() => {
    if (optionsOpen) {
      setErrorText('')
      setPetMessage(null)
    }
  }, [optionsOpen])

  useEffect(() => {
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
      <PetMessageBubble message={petMessage} position={petPosition} viewport={petViewport} />
      <HolidayCelebration open={celebration !== null} headline={celebration?.headline ?? ''} fromLabel="工作日" toLabel="休息日" onClose={closeCelebration} />
    </>
  )
}