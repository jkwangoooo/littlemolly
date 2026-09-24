import type { AnyOption } from '../../../shared/types/options'
import {
  OPTION_DRAG_HANDLE_LABEL,
  OPTION_INACTIVE_BADGE,
  OPTION_MENU_ACTIVATE,
  OPTION_MENU_DEACTIVATE,
  OPTION_MENU_DELETE,
  OPTION_MENU_LABEL,
  OPTION_MENU_MOVE_DOWN,
  OPTION_MENU_MOVE_UP,
  OPTION_MENU_RENAME,
} from '../preferencesLabels'
import { RowMenu } from './RowMenu'
import type { DragHandleProps } from '../useDragOrder'

/**
 * 单个选项行。停用项保留在列表里但用文案与样式区分，避免用户以为它被删掉了。
 *
 * 行内只留两个元素：**拖拽手柄 + 「…」溢出菜单**。
 * 之前 5 个按钮平铺在一行里（上移 / 下移 / 改名 / 停用 / 删除），
 * 12 行就是 60 个按钮，是选项页「杂乱」的主要来源（docs/17 §1）。
 *
 * 上移 / 下移没有消失，而是挪进菜单：拖拽是补充性交互，必须保留一条不用拖拽也能完成的路径
 * （Cloudscape 的无障碍要求），键盘用户与读屏用户靠的就是菜单里的这两项。
 * 「删除」是破坏性且不可逆的，排最后并用危险色，降低误触。
 */
export function OptionRow({
  option,
  detail,
  group,
  dragging,
  canMoveUp,
  canMoveDown,
  busy,
  dragHandleProps,
  onMove,
  onToggleActive,
  onRename,
  onDelete,
}: {
  option: AnyOption
  detail?: string
  group: string
  dragging: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  busy: boolean
  dragHandleProps: DragHandleProps
  onMove: (delta: -1 | 1) => void
  onToggleActive: () => void
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={`execution-row option-row${option.active ? '' : ' inactive'}${dragging ? ' dragging' : ''}`}
      data-option-row
      data-option-id={option.id}
      data-group={group}
    >
      <button
        className="drag-handle"
        type="button"
        aria-label={`${OPTION_DRAG_HANDLE_LABEL}：${option.name}`}
        disabled={busy}
        {...dragHandleProps}
      >
        <span aria-hidden="true">≡</span>
      </button>

      <span>
        <strong>{option.name}</strong>
        <small>{option.active ? detail ?? '启用中' : `${OPTION_INACTIVE_BADGE}${detail ? ` · ${detail}` : ''}`}</small>
      </span>

      <RowMenu
        label={`${option.name} ${OPTION_MENU_LABEL}`}
        items={[
          { key: 'rename', label: OPTION_MENU_RENAME, disabled: busy, onSelect: onRename },
          {
            key: 'up',
            label: OPTION_MENU_MOVE_UP,
            disabled: busy || !canMoveUp,
            onSelect: () => onMove(-1),
          },
          {
            key: 'down',
            label: OPTION_MENU_MOVE_DOWN,
            disabled: busy || !canMoveDown,
            onSelect: () => onMove(1),
          },
          {
            key: 'active',
            label: option.active ? OPTION_MENU_DEACTIVATE : OPTION_MENU_ACTIVATE,
            disabled: busy,
            onSelect: onToggleActive,
          },
          { key: 'delete', label: OPTION_MENU_DELETE, disabled: busy, danger: true, onSelect: onDelete },
        ]}
      />
    </div>
  )
}
