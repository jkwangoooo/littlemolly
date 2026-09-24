import type { ReactNode } from 'react'

export type CollapsibleSectionKey = 'prepare' | 'execute' | 'routine' | 'tasks'

export function CollapsibleSection({
  section,
  title,
  className,
  collapsed,
  onToggle,
  action,
  children,
}: {
  section: CollapsibleSectionKey
  title: string
  className?: string
  collapsed: boolean
  onToggle: () => void
  action?: ReactNode
  children: ReactNode
}) {
  const contentId = `day-plan-section-${section}-content`

  return (
    <section className={`collapsible-section${className ? ` ${className}` : ''}`} data-collapsible-section={section}>
      <div className="collapsible-section-heading">
        <button
          className="collapsible-section-toggle"
          type="button"
          data-section-toggle={section}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={onToggle}
        >
          <span>{title}</span>
          <span className="collapsible-section-indicator" aria-hidden="true">
            {collapsed ? '＋' : '−'}
          </span>
        </button>
        {action}
      </div>
      <div id={contentId} className="collapsible-section-content" hidden={collapsed}>
        {children}
      </div>
    </section>
  )
}
