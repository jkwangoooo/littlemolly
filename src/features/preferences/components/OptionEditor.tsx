import { useState } from 'react'
import type { OptionKind, SupplementPeriod } from '../../../shared/types/options'
import { SUPPLEMENT_PERIODS } from '../../../shared/types/options'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { OPTION_CREATE_TITLE, SUPPLEMENT_PERIOD_LABEL } from '../preferencesLabels'

/**
 * 新增 / 重命名选项的底部面板。补剂额外要求选择时段，其他两类只有名称。
 * 只负责收集输入，校验与落库由服务层做，错误通过 onSubmit 抛回由页面统一提示。
 */
export function OptionEditor({
  kind,
  mode,
  initialName,
  initialPeriod,
  onSubmit,
  onCancel,
}: {
  kind: OptionKind
  mode: 'create' | 'rename'
  initialName: string
  initialPeriod: SupplementPeriod
  onSubmit: (name: string, period: SupplementPeriod) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [period, setPeriod] = useState<SupplementPeriod>(initialPeriod)

  return (
    <BottomSheet
      title={mode === 'create' ? OPTION_CREATE_TITLE[kind] : '重命名选项'}
      saveLabel={mode === 'create' ? '添加' : '保存'}
      onSave={() => onSubmit(name, period)}
      onCancel={onCancel}
    >
      <label className="field">
        名称
        <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
      </label>

      {kind === 'supplement' ? (
        <label className="field">
          时段
          <select value={period} onChange={(event) => setPeriod(event.target.value as SupplementPeriod)}>
            {SUPPLEMENT_PERIODS.map((item) => (
              <option key={item} value={item}>
                {SUPPLEMENT_PERIOD_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </BottomSheet>
  )
}
