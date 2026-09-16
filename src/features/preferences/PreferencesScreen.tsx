import { useCallback, useState } from 'react'
import type { AnyOption, OptionKind, SupplementPeriod } from '../../shared/types/options'
import { SUPPLEMENT_PERIODS } from '../../shared/types/options'
import { ConfirmDialog } from '../../shared/components/ConfirmDialog'
import { useSaveRunner } from '../../shared/hooks/useSaveRunner'
import { SAVE_STATUS_PREFIX, SAVE_STATUS_TEXT } from '../../shared/saveStatus'
import { currentUser, signOut } from '../../services/api/authService'
import { supportsLocalBackup } from '../../services/backend'
import {
  createOption,
  deleteOption,
  moveOption,
  renameOption,
  seedExampleOptionsForCurrentUser,
  setOptionActive,
} from '../../services/api/optionService'
import { AccountCard } from './components/AccountCard'
import { BackupCard } from './components/BackupCard'
import { OptionEditor } from './components/OptionEditor'
import { OptionSection, type OptionGroup } from './components/OptionSection'
import { StorageCard } from './components/StorageCard'
import { BottomNav } from '../../shared/components/BottomNav'
import type { View } from '../../shared/types/view'
import {
  DELETE_CONFIRM,
  DISABLE_CONFIRM,
  OPTION_PAGE_HINT,
  SUPPLEMENT_PERIOD_LABEL,
} from './preferencesLabels'
import { useOptionLists } from './useOptionLists'

/** 弹层里正在操作的目标：必须同时记住类别，因为三类选项共用同一套行组件。 */
type OptionTarget = { kind: OptionKind; option: AnyOption }
type EditorState = { kind: OptionKind; mode: 'create' | 'rename'; option: AnyOption | null }

/**
 * 选项管理页（L1）。
 * 只负责编排：读取清单、串起写入与确认弹层、组装分区。
 * 校验与落库都在服务层，失败时保留弹层内容并显示具体原因。
 */
export function PreferencesScreen({
  onNavigate,
}: {
  onNavigate: (view: View) => void
}) {
  const { lists, selectable, loading, loadError, reload } = useOptionLists()
  const { status, saveError, canRetry, runSave, retryLastSave } = useSaveRunner()
  const [email] = useState(() => currentUser()?.email ?? '')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [pendingDisable, setPendingDisable] = useState<OptionTarget | null>(null)
  const [pendingDelete, setPendingDelete] = useState<OptionTarget | null>(null)

  /** 所有写入都经这里：成功才 reload 并让调用方关闭弹层，失败保留弹层与输入。 */
  const mutate = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      let ok = false
      await runSave(async () => {
        await action()
        await reload()
        ok = true
      })
      return ok
    },
    [runSave, reload],
  )

  async function submitEditor(name: string, period: SupplementPeriod) {
    const target = editor
    if (!target) return
    const ok =
      target.mode === 'create'
        ? await mutate(() => createOption(target.kind, { name, period }))
        : await mutate(() => renameOption(target.kind, target.option?.id ?? '', name))
    if (ok) setEditor(null)
  }

  async function confirmDisableOption() {
    const target = pendingDisable
    setPendingDisable(null)
    if (!target) return
    await mutate(() => setOptionActive(target.kind, target.option.id, false))
  }

  async function confirmDeleteOption() {
    const target = pendingDelete
    setPendingDelete(null)
    if (!target) return
    await mutate(() => deleteOption(target.kind, target.option.id))
  }

  async function handleToggleActive(target: OptionTarget) {
    // 停用会让选项从新计划的选择器中消失，属于需要确认的破坏性操作；启用直接生效。
    if (target.option.active) {
      setPendingDisable(target)
      return
    }
    await mutate(() => setOptionActive(target.kind, target.option.id, true))
  }

  const foodGroups: OptionGroup[] = [{ key: 'food', options: lists.food }]
  const exerciseGroups: OptionGroup[] = [{ key: 'exercise', options: lists.exercise }]
  const supplementGroups: OptionGroup[] = SUPPLEMENT_PERIODS.map((period) => ({
    key: period,
    label: SUPPLEMENT_PERIOD_LABEL[period],
    options: lists.supplement.filter((item) => item.period === period),
    detail: () => `时段：${SUPPLEMENT_PERIOD_LABEL[period]}`,
  }))

  const totalOptions = lists.food.length + lists.supplement.length + lists.exercise.length
  const busy = status === 'saving'

  const sectionProps = {
    busy,
    onMove: (kind: OptionKind) => (option: AnyOption, delta: -1 | 1) =>
      void mutate(() => moveOption(kind, option.id, delta)),
    onToggleActive: (kind: OptionKind) => (option: AnyOption) => void handleToggleActive({ kind, option }),
    onRename: (kind: OptionKind) => (option: AnyOption) => setEditor({ kind, mode: 'rename', option }),
    onDelete: (kind: OptionKind) => (option: AnyOption) => setPendingDelete({ kind, option }),
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">幸福小Molly</p>
          <h1>选项</h1>
        </div>
      </header>

      <section className="panel stack">
        <p className="muted">{OPTION_PAGE_HINT}</p>

        <p className={`status ${status}`} aria-live="polite">
          {SAVE_STATUS_PREFIX}
          {SAVE_STATUS_TEXT[status]}
        </p>

        {saveError ? (
          <p className="notice" role="alert">
            保存失败：{saveError}
            <button
              className="secondary retry"
              type="button"
              disabled={status === 'saving' || !canRetry}
              onClick={() => void retryLastSave()}
            >
              重试
            </button>
          </p>
        ) : null}

        {!saveError && loadError ? (
          <p className="notice" role="alert">
            读取失败：{loadError}
          </p>
        ) : null}

        {loading ? (
          <p className="muted loading-note" role="status">
            正在读取选项…
          </p>
        ) : (
          <>
            {totalOptions === 0 ? (
              <div className="empty-day">
                <strong>还没有任何选项</strong>
                <p className="muted">可以先载入一组示例食物、补剂和健身项目，再按自己的习惯改。</p>
                <div className="actions">
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => void mutate(() => seedExampleOptionsForCurrentUser())}
                  >
                    载入示例选项
                  </button>
                </div>
              </div>
            ) : null}

            <OptionSection
              kind="food"
              groups={foodGroups}
              selectableCount={selectable.food}
              onAdd={() => setEditor({ kind: 'food', mode: 'create', option: null })}
              onMove={sectionProps.onMove('food')}
              onToggleActive={sectionProps.onToggleActive('food')}
              onRename={sectionProps.onRename('food')}
              onDelete={sectionProps.onDelete('food')}
              busy={busy}
            />

            <OptionSection
              kind="supplement"
              groups={supplementGroups}
              selectableCount={selectable.supplement}
              onAdd={() => setEditor({ kind: 'supplement', mode: 'create', option: null })}
              onMove={sectionProps.onMove('supplement')}
              onToggleActive={sectionProps.onToggleActive('supplement')}
              onRename={sectionProps.onRename('supplement')}
              onDelete={sectionProps.onDelete('supplement')}
              busy={busy}
            />

            <OptionSection
              kind="exercise"
              groups={exerciseGroups}
              selectableCount={selectable.exercise}
              onAdd={() => setEditor({ kind: 'exercise', mode: 'create', option: null })}
              onMove={sectionProps.onMove('exercise')}
              onToggleActive={sectionProps.onToggleActive('exercise')}
              onRename={sectionProps.onRename('exercise')}
              onDelete={sectionProps.onDelete('exercise')}
              busy={busy}
            />

            <BackupCard available={supportsLocalBackup} busy={busy} runSave={runSave} onImported={reload} />

            <StorageCard />

            <AccountCard email={email} onSignOut={() => void signOut()} />
          </>
        )}
      </section>

      {editor ? (
        <OptionEditor
          key={`${editor.kind}-${editor.mode}-${editor.option?.id ?? 'new'}`}
          kind={editor.kind}
          mode={editor.mode}
          initialName={editor.option?.name ?? ''}
          initialPeriod={
            editor.option && 'period' in editor.option ? editor.option.period : 'morning'
          }
          onSubmit={(name, period) => void submitEditor(name, period)}
          onCancel={() => setEditor(null)}
        />
      ) : null}

      {pendingDisable ? (
        <ConfirmDialog
          title={DISABLE_CONFIRM.title}
          description={DISABLE_CONFIRM.body}
          confirmLabel={DISABLE_CONFIRM.confirmLabel}
          onConfirm={() => void confirmDisableOption()}
          onCancel={() => setPendingDisable(null)}
        >
          <p className="muted">{pendingDisable.option.name}</p>
        </ConfirmDialog>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title={DELETE_CONFIRM.title}
          description={DELETE_CONFIRM.body}
          confirmLabel={DELETE_CONFIRM.confirmLabel}
          onConfirm={() => void confirmDeleteOption()}
          onCancel={() => setPendingDelete(null)}
        >
          <p className="muted">{pendingDelete.option.name}</p>
        </ConfirmDialog>
      ) : null}

      <BottomNav current="options" onNavigate={onNavigate} />
    </main>
  )
}
