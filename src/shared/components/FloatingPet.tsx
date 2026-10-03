import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

const PET_SIZE = 88
const EDGE_GAP = 14
const BOTTOM_SAFE_GAP = 76
const DRAG_THRESHOLD = 6
const FRAME_ROOT = '/pets/ember-monkey-v1/frames/'

type PetState = 'idle' | 'happy' | 'dragging' | 'settling'
type Facing = 'left' | 'right'
type Position = { x: number; y: number }
type DragSession = Position & { pointerId: number; offsetX: number; offsetY: number; moved: boolean; lastX: number }
type BubblePlacement = 'top' | 'bottom' | 'left' | 'right'
type AnimationMode = 'idle' | 'blink' | 'walk' | 'settle'

const FRAME_FILES: Record<AnimationMode, string[]> = {
  idle: ['01-待机睁眼-01.png', '02-待机火焰-02.png', '03-待机火焰-03.png', '02-待机火焰-02.png'],
  blink: ['04-眨眼半闭.png', '05-眨眼闭眼.png', '04-眨眼半闭.png', '01-待机睁眼-01.png'],
  walk: ['06-左走-01.png', '07-左走-02.png', '08-左走-03.png', '09-左走-04.png', '10-左走-05.png', '11-左走-06.png'],
  settle: ['12-释放缓冲-01.png', '13-释放恢复-02.png', '01-待机睁眼-01.png'],
}

function getViewport() { const visual = window.visualViewport; return { width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight, offsetLeft: visual?.offsetLeft ?? 0, offsetTop: visual?.offsetTop ?? 0 } }
function clampPosition(position: Position): Position { const viewport = getViewport(); const maxX = Math.max(EDGE_GAP, viewport.offsetLeft + viewport.width - PET_SIZE - EDGE_GAP); const maxY = Math.max(EDGE_GAP, viewport.offsetTop + viewport.height - PET_SIZE - BOTTOM_SAFE_GAP); return { x: Math.min(Math.max(position.x, viewport.offsetLeft + EDGE_GAP), maxX), y: Math.min(Math.max(position.y, viewport.offsetTop + EDGE_GAP), maxY) } }
function initialPosition(): Position { const viewport = getViewport(); return clampPosition({ x: viewport.offsetLeft + viewport.width - PET_SIZE - EDGE_GAP, y: viewport.offsetTop + viewport.height - PET_SIZE - BOTTOM_SAFE_GAP }) }
function placementFor(position: Position): BubblePlacement { const viewport = getViewport(); const rightSpace = viewport.offsetLeft + viewport.width - (position.x + PET_SIZE); const leftSpace = position.x - viewport.offsetLeft; const topSpace = position.y - viewport.offsetTop; const bottomSpace = viewport.offsetTop + viewport.height - (position.y + PET_SIZE); if (topSpace >= 150) return 'top'; if (bottomSpace >= 150) return 'bottom'; if (rightSpace >= 252) return 'right'; if (leftSpace >= 252) return 'left'; return topSpace >= bottomSpace ? 'top' : 'bottom' }

export function FloatingPet({ onPositionChange }: { onPositionChange?: (position: { x: number; y: number; size: number }) => void }) {
  const petRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<DragSession | null>(null)
  const timerRef = useRef<number | null>(null)
  const blinkTimerRef = useRef<number | null>(null)
  const [position, setPosition] = useState<Position>(initialPosition)
  const [petState, setPetState] = useState<PetState>('idle')
  const [facing, setFacing] = useState<Facing>('left')
  const [animationMode, setAnimationMode] = useState<AnimationMode>('idle')
  const [frameIndex, setFrameIndex] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [isHidden, setIsHidden] = useState(false)
  const clearTimer = useCallback((ref: React.MutableRefObject<number | null>) => { if (ref.current !== null) { window.clearTimeout(ref.current); ref.current = null } }, [])
  const reposition = useCallback(() => setPosition((current) => clampPosition(current)), [])

  useEffect(() => { window.addEventListener('resize', reposition); window.visualViewport?.addEventListener('resize', reposition); window.visualViewport?.addEventListener('scroll', reposition); return () => { window.removeEventListener('resize', reposition); window.visualViewport?.removeEventListener('resize', reposition); window.visualViewport?.removeEventListener('scroll', reposition) } }, [reposition])
  useEffect(() => () => { clearTimer(timerRef); clearTimer(blinkTimerRef) }, [clearTimer])
  useEffect(() => { if (petState !== 'idle' || animationMode !== 'idle') return; clearTimer(blinkTimerRef); blinkTimerRef.current = window.setTimeout(() => { setAnimationMode('blink'); setFrameIndex(0) }, 4500 + Math.round(Math.random() * 2000)); return () => clearTimer(blinkTimerRef) }, [animationMode, clearTimer, petState])
  useEffect(() => { if (animationMode === 'idle') return; clearTimer(timerRef); const frames = FRAME_FILES[animationMode]; const interval = animationMode === 'walk' ? 180 : animationMode === 'blink' ? 130 : 180; timerRef.current = window.setTimeout(function advance() { setFrameIndex((current) => { const next = current + 1; if (next >= frames.length) { if (animationMode === 'blink' || animationMode === 'settle') { setAnimationMode('idle'); setPetState('idle') }; return 0 } return next }); timerRef.current = window.setTimeout(advance, interval) }, interval); return () => clearTimer(timerRef) }, [animationMode, clearTimer])

  function openOrClose() { setIsOpen((current) => !current); setPetState('happy'); setAnimationMode('idle'); setFrameIndex(0); clearTimer(timerRef); timerRef.current = window.setTimeout(() => setPetState('idle'), 900) }
  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) { if (dragRef.current || !event.isPrimary) return; const rect = event.currentTarget.getBoundingClientRect(); dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, x: position.x, y: position.y, moved: false, lastX: event.clientX }; event.currentTarget.setPointerCapture(event.pointerId); setPetState('dragging'); setAnimationMode('walk'); setFrameIndex(0) }
  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) { const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return; const next = clampPosition({ x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY }); if (Math.hypot(next.x - drag.x, next.y - drag.y) > DRAG_THRESHOLD) drag.moved = true; const dx = event.clientX - drag.lastX; if (Math.abs(dx) >= 1.5) setFacing(dx < 0 ? 'left' : 'right'); drag.x = next.x; drag.y = next.y; drag.lastX = event.clientX; setPosition(next) }
  function finishPointer(event: ReactPointerEvent<HTMLButtonElement>) { const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return; dragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (!drag.moved) { setPetState('idle'); setAnimationMode('idle'); openOrClose(); return } clearTimer(timerRef); setPetState('settling'); setAnimationMode('settle'); setFrameIndex(0) }
  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openOrClose() }; if (event.key === 'Escape') setIsOpen(false) }

  useEffect(() => { const cancelDrag = () => { if (!dragRef.current) return; dragRef.current = null; setPetState('idle'); setAnimationMode('idle'); setFrameIndex(0) }; window.addEventListener('blur', cancelDrag); return () => window.removeEventListener('blur', cancelDrag) }, [])
  useEffect(() => { if (!isOpen) return; const handleDocumentPointerDown = (event: PointerEvent) => { const target = event.target; if (target instanceof Node && (petRef.current?.contains(target) || document.querySelector('[data-floating-pet-bubble]')?.contains(target))) return; setIsOpen(false) }; const handleDocumentKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsOpen(false) }; document.addEventListener('pointerdown', handleDocumentPointerDown); document.addEventListener('keydown', handleDocumentKeyDown); return () => { document.removeEventListener('pointerdown', handleDocumentPointerDown); document.removeEventListener('keydown', handleDocumentKeyDown) } }, [isOpen])
  useEffect(() => { onPositionChange?.({ ...position, size: PET_SIZE }) }, [onPositionChange, position])

  if (isHidden) return <button className="floating-pet-restore" type="button" aria-label="显示悬浮小火球" title="显示悬浮小火球" onClick={() => setIsHidden(false)}><span aria-hidden="true">✦</span></button>
  const style = { '--pet-x': `${position.x}px`, '--pet-y': `${position.y}px` } as CSSProperties; const placement = placementFor(position); const viewport = getViewport(); const bubbleWidth = Math.min(236, viewport.width - 32); const bubbleHeight = 106; const bubbleX = Math.min(Math.max(position.x, viewport.offsetLeft + 16), viewport.offsetLeft + viewport.width - bubbleWidth - 16); const bubbleY = placement === 'top' ? Math.max(viewport.offsetTop + 16, position.y - bubbleHeight - 12) : Math.min(position.y + PET_SIZE + 12, viewport.offsetTop + viewport.height - bubbleHeight - 16); const bubbleStyle = { '--bubble-x': `${bubbleX}px`, '--bubble-y': `${bubbleY}px` } as CSSProperties; const frame = FRAME_FILES[animationMode][frameIndex % FRAME_FILES[animationMode].length]
  return <div className={`floating-pet-layer floating-pet-${petState}`} style={style}>
    {isOpen ? <aside className={`floating-pet-bubble floating-pet-bubble-${placement}`} style={bubbleStyle} data-floating-pet-bubble role="dialog" aria-label="Molly 小火球提示"><button className="floating-pet-bubble-close" type="button" aria-label="关闭小火球提示" onClick={() => setIsOpen(false)}>×</button><strong>嗨，我是 Molly 的小火球</strong><span>今天也要慢慢完成一件事</span><button className="floating-pet-hide" type="button" onClick={() => { setIsOpen(false); setIsHidden(true) }}>隐藏小火球</button></aside> : null}
    <button ref={petRef} className="floating-pet" type="button" aria-label="Molly 的小火球，可拖动，按 Enter 或空格打开提示" aria-expanded={isOpen} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} onKeyDown={handleKeyDown}><img className={`floating-pet-sprite floating-pet-sprite-${facing}`} src={`${FRAME_ROOT}${frame}`} alt="" draggable={false} aria-hidden="true" /></button>
  </div>
}
