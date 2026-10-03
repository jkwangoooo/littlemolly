import { useEffect, useRef } from 'react'

const COLORS = ['#d87f88', '#d9b75f', '#94b8a2', '#83aebb', '#a9a7c6', '#f0a66f', '#cf7194', '#78a99a']
type Particle = { x: number; y: number; vx: number; vy: number; gravity: number; drag: number; wind: number; width: number; height: number; rotation: number; spin: number; color: string; life: number; maxLife: number; delay: number }

export function CelebrationParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const mobile = window.matchMedia('(max-width: 620px)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = window.innerWidth
    const height = window.innerHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    context.setTransform(dpr, 0, 0, dpr, 0, 0)

    const particles: Particle[] = Array.from({ length: mobile ? 150 : 280 }, (_, index) => {
      const fromRight = index % 2 === 1
      return {
        x: fromRight ? width + 8 : -8,
        y: height * (0.38 + Math.random() * 0.14),
        vx: (fromRight ? -1 : 1) * (width * (0.16 + Math.random() * 0.24)),
        vy: -(height * (0.28 + Math.random() * 0.2)),
        gravity: height * (0.36 + Math.random() * 0.22),
        drag: 0.985 + Math.random() * 0.01,
        wind: (Math.random() - 0.5) * (mobile ? 8 : 14),
        width: 4 + Math.random() * 5,
        height: 7 + Math.random() * 8,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 10,
        color: COLORS[index % COLORS.length],
        life: 0,
        maxLife: 2.7 + Math.random() * 0.9,
        delay: Math.random() * 0.16,
      }
    })

    let previous = performance.now()
    const frame = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.032)
      previous = now
      context.clearRect(0, 0, width, height)
      let alive = false
      for (const particle of particles) {
        if (particle.delay > 0) {
          particle.delay -= delta
          alive = true
          continue
        }
        particle.life += delta
        particle.vx += particle.wind * delta
        particle.vx *= Math.pow(particle.drag, delta * 60)
        particle.vy += particle.gravity * delta
        particle.x += particle.vx * delta
        particle.y += particle.vy * delta
        particle.rotation += particle.spin * delta
        if (particle.life >= particle.maxLife || particle.y > height + 40) continue
        alive = true
        const fade = particle.life < 0.25 ? particle.life / 0.25 : Math.min(1, (particle.maxLife - particle.life) / 0.72)
        context.save()
        context.globalAlpha = Math.max(0, fade) * 0.92
        context.translate(particle.x, particle.y)
        context.rotate(particle.rotation)
        context.fillStyle = particle.color
        context.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height)
        context.restore()
      }
      if (alive) frameRef.current = window.requestAnimationFrame(frame)
      else context.clearRect(0, 0, width, height)
    }
    frameRef.current = window.requestAnimationFrame(frame)
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      context.clearRect(0, 0, width, height)
    }
  }, [])

  return <canvas ref={canvasRef} className="holiday-celebration-canvas" />
}
