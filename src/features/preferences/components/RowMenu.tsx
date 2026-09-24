import { useEffect, useRef, useState } from 'react'

export type RowMenuItem = {
  key: string
  label: string
  disabled?: boolean
  /** 破坏性动作，单独用危险色，且排在最后。 */
  danger?: boolean
  onSelect: () => void
}

/**
 * 行内溢出菜单（「…」）。每一行从 5 个平铺按钮收成一个入口，是这次信息架构调整里
 * 减少噪音的主要手段（docs/17 §2.5：一行超过 3 个动作就该收进溢出菜单）。
 *
 * 为什么用 `position: fixed` 而不是绝对定位在行内：菜单在可滚动的内容区里，
 * 绝对定位会被 `overflow: auto` 裁掉——最后几行的菜单根本看不见。
 * 固定定位配合「按触发按钮的位置算坐标 + 空间不够就向上展开」可以彻底绕开裁剪。
 * 代价是滚动时菜单不会跟着走，所以滚动一开始就把它关掉。
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const open = position !== null

  useEffect(() => {
    if (!open) return
    const close = () => setPosition(null)
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // 捕获阶段监听滚动：内容区自身的滚动不会冒泡到 document。
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  function toggle() {
    if (open) {
      setPosition(null)
      return
    }
    const trigger = triggerRef.current
    if (!trigger) return
    const box = trigger.getBoundingClientRect()
    const width = 150
    const height = items.length * 40 + 12
    const left = Math.min(Math.max(8, box.right - width), window.innerWidth - width - 8)
    // 下方放不下就向上展开，避免菜单跑出可视区。
    const top = box.bottom + height + 8 > window.innerHeight ? Math.max(8, box.top - height - 4) : box.bottom + 4
    setPosition({ top, left })
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="row-menu-trigger secondary mini"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <span aria-hidden="true">…</span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          className="row-menu-list"
          role="menu"
          aria-label={label}
          style={{ top: position.top, left: position.left }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              className={`row-menu-item${item.danger ? ' danger' : ''}`}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setPosition(null)
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}
