import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import './holidayCelebration.css'
import { CelebrationParticles } from './CelebrationParticles'

export type HolidayCelebrationCloseReason = 'natural' | 'skip' | 'escape'

type CelebrationPhase =
  | 'old-state'
  | 'release'
  | 'burst'
  | 'settle'
  | 'outro'
  | 'fade-out'
  | 'reduced'

type HolidayCelebrationProps = {
  open: boolean
  headline: string
  fromLabel?: string
  toLabel?: string
  onClose: (reason: HolidayCelebrationCloseReason) => void
  forceReducedMotion?: boolean
}

export function HolidayCelebration({
  open,
  headline,
  fromLabel = '工作日',
  toLabel = '休息日',
  onClose,
  forceReducedMotion = false,
}: HolidayCelebrationProps) {
  const [phase, setPhase] = useState<CelebrationPhase>('old-state')
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const skipButtonRef = useRef<HTMLButtonElement>(null)
  const activeElementRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  const hasClosedRef = useRef(false)

  closeRef.current = onClose

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setSystemReducedMotion(mediaQuery.matches)
    updatePreference()
    mediaQuery.addEventListener('change', updatePreference)
    return () => mediaQuery.removeEventListener('change', updatePreference)
  }, [])

  const reducedMotion = forceReducedMotion || systemReducedMotion

  useEffect(() => {
    if (!open) return

    activeElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    hasClosedRef.current = false
    setPhase(reducedMotion ? 'reduced' : 'old-state')

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => skipButtonRef.current?.focus())
    const timers: number[] = []

    const finish = (reason: HolidayCelebrationCloseReason) => {
      if (hasClosedRef.current) return
      hasClosedRef.current = true
      closeRef.current(reason)
    }

    if (reducedMotion) {
      timers.push(window.setTimeout(() => finish('natural'), 520))
    } else {
      timers.push(window.setTimeout(() => setPhase('release'), 360))
      timers.push(window.setTimeout(() => setPhase('burst'), 700))
      timers.push(window.setTimeout(() => setPhase('settle'), 1900))
      timers.push(window.setTimeout(() => setPhase('outro'), 3800))
      timers.push(window.setTimeout(() => setPhase('fade-out'), 4350))
      timers.push(window.setTimeout(() => finish('natural'), 5350))
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        finish('escape')
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        finish('skip')
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        skipButtonRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      timers.forEach((timer) => window.clearTimeout(timer))
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      activeElementRef.current?.focus()
    }
  }, [open, reducedMotion])

  if (!open) return null

  const phaseLabel = reducedMotion
    ? '已保存到本地，减少动态效果已启用'
    : phase === 'old-state'
      ? `${fromLabel}正在退场`
      : phase === 'release'
        ? '安排松开了'
        : phase === 'burst'
          ? '已保存到本地'
          : `${toLabel}已落定`

  function handleSkip() {
    if (hasClosedRef.current) return
    hasClosedRef.current = true
    closeRef.current('skip')
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (hasClosedRef.current) return
      hasClosedRef.current = true
      closeRef.current('skip')
    }
  }

  return createPortal(
    <div
      className={`holiday-celebration holiday-celebration-${phase}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="holiday-celebration-title"
      data-testid="holiday-celebration"
      data-phase={phase}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="holiday-celebration-backdrop" aria-hidden="true" />
      <div className="holiday-celebration-particles" aria-hidden="true">
        {!reducedMotion ? <CelebrationParticles /> : null}
      </div>

      <div className="holiday-celebration-stage">
        <div className="holiday-visual-stack" aria-hidden="true">
          <div className="holiday-visual-card holiday-visual-card-back" />
          <div className="holiday-visual-card holiday-visual-card-middle" />
          <div className="holiday-visual-card holiday-visual-card-old">
            <span>今天的模式</span>
            <strong>{fromLabel}</strong>
            <small>安排先放在这里</small>
          </div>
          <div className="holiday-visual-card holiday-visual-card-new">
            <span>今天的模式</span>
            <strong>{toLabel}</strong>
            <small>留一点时间给自己</small>
          </div>
        </div>

        <div className="holiday-celebration-copy">
          <h1 id="holiday-celebration-title">
            <span>幸福小Molly</span>
            <strong>{headline}</strong>
          </h1>
          <p role="status" aria-live="polite">{phaseLabel}</p>
        </div>

        <button
          ref={skipButtonRef}
          className="holiday-celebration-skip"
          type="button"
          onClick={handleSkip}
        >
          跳过演出
        </button>
      </div>
    </div>,
    document.body,
  )
}
