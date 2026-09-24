import type { SupplementPeriod } from '../../../shared/types/options'
import { SUPPLEMENT_PERIODS } from '../../../shared/types/options'
import { SUPPLEMENT_PERIOD_LABEL } from '../../../shared/periodLabels'
import { SUPPLEMENT_PANEL } from '../dayPlanLabels'
import { supplementKey, type SupplementDraftRow } from '../panelDrafts'

/**
 * 补剂面板：按时段分组列出这一天的补剂清单，勾选「今天吃」或移除自定义项。
 *
 * 某一行是不是「模板来源」，判据是「此刻是否命中一个启用中的模板」，而不是记录来源标记：
 * 命中意味着删掉它下次补齐还会回来，所以这样的行只允许取消勾选，不给删除按钮。
 * 用户自己加的项一旦与模板同名同时段，也一并按模板项对待——补齐逻辑本来也不会重复加它。
 */
export function SupplementPanel({
  draft,
  keys,
  disabled,
  onPatch,
  onRemove,
  onAdd,
}: {
  draft: SupplementDraftRow[]
  keys: Set<string>
  disabled: boolean
  onPatch: (index: number, patch: Partial<SupplementDraftRow>) => void
  onRemove: (index: number) => void
  onAdd: (period: SupplementPeriod) => void
}) {
  return (
    <>
      <p className="muted panel-hint">{SUPPLEMENT_PANEL.hint}</p>
      {draft.length === 0 ? <p className="picker-note">{SUPPLEMENT_PANEL.empty}</p> : null}

      {SUPPLEMENT_PERIODS.map((period) => {
        const rows = draft.map((row, index) => ({ row, index })).filter((item) => item.row.period === period)
        return (
          <div className="panel-group" data-period={period} key={period}>
            <p className="panel-group-label">{SUPPLEMENT_PERIOD_LABEL[period]}</p>

            {rows.map(({ row, index }) => {
              const fromTemplate = keys.has(supplementKey(row.period, row.name))
              return (
                <div className="panel-row" key={row.id ?? `new-${period}-${index}`}>
                  {fromTemplate ? (
                    <span className="panel-row-name">{row.name}</span>
                  ) : (
                    <input
                      value={row.name}
                      disabled={disabled}
                      placeholder={SUPPLEMENT_PANEL.namePlaceholder}
                      aria-label={SUPPLEMENT_PANEL.namePlaceholder}
                      onChange={(event) => onPatch(index, { name: event.target.value })}
                    />
                  )}
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={row.planned}
                      disabled={disabled}
                      aria-label={`${SUPPLEMENT_PANEL.planned} ${row.name}`}
                      onChange={() => onPatch(index, { planned: !row.planned })}
                    />
                    <span>{SUPPLEMENT_PANEL.planned}</span>
                  </label>
                  {fromTemplate ? null : (
                    <button className="secondary mini" type="button" disabled={disabled} onClick={() => onRemove(index)}>
                      {SUPPLEMENT_PANEL.remove}
                    </button>
                  )}
                </div>
              )
            })}

            <button className="secondary mini" type="button" disabled={disabled} onClick={() => onAdd(period)}>
              {SUPPLEMENT_PANEL.add}
            </button>
          </div>
        )
      })}

      <p className="muted panel-hint">{SUPPLEMENT_PANEL.templateNote}</p>
      <p className="muted panel-hint">{SUPPLEMENT_PANEL.customNote}</p>
    </>
  )
}
