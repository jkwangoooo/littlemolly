import type { AnyOption } from '../../../shared/types/options'

/**
 * 单个选项行。停用项保留在列表里但用文案与样式区分，避免用户以为它被删掉了。
 * 上移 / 下移由调用方按「同组内是否还有邻居」传入可用性，跨分组不允许移动。
 */
export function OptionRow({
  option,
  detail,
  canMoveUp,
  canMoveDown,
  busy,
  onMove,
  onToggleActive,
  onRename,
  onDelete,
}: {
  option: AnyOption
  detail?: string
  canMoveUp: boolean
  canMoveDown: boolean
  busy: boolean
  onMove: (delta: -1 | 1) => void
  onToggleActive: () => void
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <div className={`execution-row option-row${option.active ? '' : ' inactive'}`}>
      <span>
        <strong>{option.name}</strong>
        <small>{option.active ? detail ?? '启用中' : `已停用${detail ? ` · ${detail}` : ''}`}</small>
      </span>
      <div className="option-actions">
        <button className="secondary mini" type="button" disabled={busy || !canMoveUp} onClick={() => onMove(-1)}>
          上移
        </button>
        <button className="secondary mini" type="button" disabled={busy || !canMoveDown} onClick={() => onMove(1)}>
          下移
        </button>
        <button className="secondary mini" type="button" disabled={busy} onClick={onRename}>
          改名
        </button>
        <button className="secondary mini" type="button" disabled={busy} onClick={onToggleActive}>
          {option.active ? '停用' : '启用'}
        </button>
        <button className="secondary mini" type="button" disabled={busy} onClick={onDelete}>
          删除
        </button>
      </div>
    </div>
  )
}
