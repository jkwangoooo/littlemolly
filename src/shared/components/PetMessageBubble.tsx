import { useEffect, useState, type CSSProperties } from 'react'

export type PetMessage = { id: number; title: string; text: string }
export type PetPosition = { x: number; y: number; size: number }

type PetMessageBubbleProps = {
  message: PetMessage | null
  position: PetPosition | null
  viewport: { width: number; height: number; offsetLeft: number; offsetTop: number }
}

export function PetMessageBubble({ message, position, viewport }: PetMessageBubbleProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!message) {
      setVisible(false)
      return
    }
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 3200)
    return () => window.clearTimeout(timer)
  }, [message])

  if (!visible || !message || !position) return null

  const width = Math.min(244, viewport.width - 32)
  const height = 96
  const gap = 12
  const roomAbove = position.y - viewport.offsetTop
  const roomBelow = viewport.offsetTop + viewport.height - (position.y + position.size)
  const placeAbove = roomAbove >= height + gap || roomAbove >= roomBelow
  const left = Math.min(Math.max(position.x + position.size / 2 - width / 2, viewport.offsetLeft + 16), viewport.offsetLeft + viewport.width - width - 16)
  const top = placeAbove ? Math.max(viewport.offsetTop + 12, position.y - height - gap) : Math.min(position.y + position.size + gap, viewport.offsetTop + viewport.height - height - 12)
  const style = { left: `${left}px`, top: `${top}px` } as CSSProperties

  return (
    <aside className={`pet-message-bubble${placeAbove ? ' pet-message-bubble-above' : ' pet-message-bubble-below'}`} role="status" aria-live="polite" style={style}>
      <button className="pet-message-bubble-close" type="button" aria-label="关闭鼓励消息" onClick={() => setVisible(false)}>×</button>
      <strong>{message.title}</strong>
      <span>{message.text}</span>
    </aside>
  )
}