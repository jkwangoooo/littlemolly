import type { View } from '../types/view'

/**
 * 底部固定导航：今日 / 本周 / 选项（docs/02 应用导航）。
 *
 * 三个主入口统一固定到屏幕底部，方便手机单手切换；桌面宽屏同样适用（内容区居中，
 * 导航栏随视口宽度居中）。当前页高亮，其余页可点跳转。
 */
export function BottomNav({
  current,
  onNavigate,
}: {
  current: View
  onNavigate: (view: View) => void
}) {
  const items: { key: View; label: string }[] = [
    { key: 'day', label: '今日' },
    { key: 'week', label: '本周' },
    { key: 'options', label: '选项' },
  ]

  return (
    <nav className="bottom-nav" aria-label="主导航">
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
