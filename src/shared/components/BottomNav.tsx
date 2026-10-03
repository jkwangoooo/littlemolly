export type DayDestination = 'execute' | 'prepare'

export function BottomNav({
  current,
  onNavigate,
}: {
  current: DayDestination | null
  onNavigate: (destination: DayDestination) => void
}) {
  const items: { key: DayDestination; label: string }[] = [
    { key: 'execute', label: '执行今天' },
    { key: 'prepare', label: '准备明天' },
  ]

  return (
    <nav className="bottom-nav" aria-label="日程导航">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={current === item.key ? 'active' : ''}
          aria-current={current === item.key ? 'page' : undefined}
          onClick={() => onNavigate(item.key)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  )
}
