import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * 「按住手柄拖动排序」的状态机。触摸与鼠标共用 Pointer Events，
 * 因为 HTML5 的 draggable 在移动端根本不触发。
 *
 * ## 为什么是「拖动时实时换位」而不是「跟手的浮层」
 *
 * 跟手浮层需要把被拖的行绝对定位、再让其它行让位，行高不一致时很容易算错位置。
 * 这里用的是列表排序最常见的做法：**指针越过某一行的中线，就把被拖项换到那一行**，
 * 于是列表随着手指实时重排，被拖行带 `dragging` 高亮，用户始终看得见自己拖到了哪。
 * 每次 move 都重新量一遍各行的位置，不缓存矩形——行数是个位数，量一次的代价可以忽略。
 *
 * ## 分组约束
 *
 * 补剂按早 / 中 / 晚分组，跨组移动在服务层本来就不允许（`moveOption` 只在同组内交换）。
 * 所以拖拽只在**同一个 data-group 内**取行，越界自然被夹住，不会出现「拖过去了但没生效」。
 *
 * ## 提交时机
 *
 * 松手后先 `await onCommit(...)`（父组件负责保存并重新读取），**保存成功才解除乐观顺序**。
 * 否则会出现「松手瞬间弹回原位、几十毫秒后再跳到新位置」的闪动——正是「显得廉价」的那种细节。
 */
export type DragHandleProps = {
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

type Session = {
  id: string
  group: string
  /** 拖拽开始时该组的顺序，用来算最终位移。 */
  origin: string[]
  from: number
  current: number
}

export function useDragOrder({
  containerRef,
  onCommit,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  onCommit: (id: string, delta: number) => Promise<void>
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  /** 拖拽期间的乐观顺序：只在正在拖的那一组上生效。 */
  const [draft, setDraft] = useState<{ group: string; ids: string[] } | null>(null)
  const session = useRef<Session | null>(null)

  const rowsOf = useCallback(
    (group: string) =>
      Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>(`[data-option-row][data-group="${group}"]`) ?? [],
      ),
    [containerRef],
  )

  async function finish() {
    const active = session.current
    session.current = null
    setDraggingId(null)
    if (!active) return
    const delta = active.current - active.from
    if (delta !== 0) await onCommit(active.id, delta)
    setDraft(null)
  }

  const handleProps = useCallback(
    (id: string, group: string, ids: string[]): DragHandleProps => ({
      onPointerDown: (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const from = ids.indexOf(id)
        if (from < 0) return
        // 阻止默认行为与后续的文本选择；滚动由手柄上的 touch-action: none 挡掉。
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        session.current = { id, group, origin: [...ids], from, current: from }
        setDraggingId(id)
        setDraft({ group, ids: [...ids] })
      },
      onPointerMove: (event) => {
        const active = session.current
        if (!active) return
        const rows = rowsOf(active.group)
        if (rows.length < 2) return

        // 指针越过了哪一行的中线，就至少排到那一行。
        let target = 0
        rows.forEach((row, index) => {
          const box = row.getBoundingClientRect()
          if (event.clientY >= box.top + box.height / 2) target = index
        })
        if (target === active.current) return

        setDraft((current) => {
          const base = current?.group === active.group ? current.ids : active.origin
          const next = [...base]
          const [moved] = next.splice(active.current, 1)
          next.splice(target, 0, moved)
          return { group: active.group, ids: next }
        })
        active.current = target
      },
      onPointerUp: () => {
        void finish()
      },
      onPointerCancel: () => {
        session.current = null
        setDraggingId(null)
        setDraft(null)
      },
    }),
    // rowsOf 是唯一的外部依赖；finish 读取的是 ref 里的最新会话，不需要进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowsOf],
  )

  /** 某一组当前应该渲染的顺序；不在拖拽中时返回 null，表示按服务层给的顺序渲染。 */
  const orderOf = useCallback(
    (group: string) => (draft?.group === group ? draft.ids : null),
    [draft],
  )

  return { draggingId, orderOf, handleProps }
}
