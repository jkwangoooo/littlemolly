import { useCallback, useState } from 'react'
<<<<<<< HEAD
import { currentUser } from '../../services/api/authService'
=======
>>>>>>> origin/main
import type { AnyOption, OptionKind, SupplementPeriod } from '../../shared/types/options'
import { SUPPLEMENT_PERIODS } from '../../shared/types/options'
import { ConfirmDialog } from '../../shared/components/ConfirmDialog'
import { useSaveRunner } from '../../shared/hooks/useSaveRunner'
import { SAVE_STATUS_PREFIX, SAVE_STATUS_TEXT } from '../../shared/saveStatus'
<<<<<<< HEAD
=======
import { currentUser, signOut } from '../../services/api/authService'
import { supportsLocalBackup } from '../../services/backend'
>>>>>>> origin/main
import {
  createOption,
  deleteOption,
  moveOption,
  renameOption,
  seedExampleOptionsForCurrentUser,
  setOptionActive,
} from '../../services/api/optionService'
import { BackupCard } from './components/BackupCard'
import { AccountCard } from './components/AccountCard'
<<<<<<< HEAD
import { SyncCard } from './components/SyncCard'
import { OptionEditor } from './components/OptionEditor'
import { OptionListScreen, type OptionListGroup } from './components/OptionListScreen'
import { OptionsOverview } from './components/OptionsOverview'
import { StorageCard } from './components/StorageCard'
=======
import { OptionEditor } from './components/OptionEditor'
import { OptionListScreen, type OptionListGroup } from './components/OptionListScreen'
import { OptionsOverview, type OptionsSection } from './components/OptionsOverview'
import { StorageCard } from './components/StorageCard'
import { BottomNav } from '../../shared/components/BottomNav'
import type { View } from '../../shared/types/view'
>>>>>>> origin/main
import {
  ACCOUNT_TITLE,
  BACKUP_TITLE,
  DELETE_CONFIRM,
  DISABLE_CONFIRM,
  OPTIONS_BACK_LABEL,
  OPTIONS_OVERVIEW_HINT,
  OPTION_KIND_TITLE,
  STORAGE_TITLE,
  SUPPLEMENT_PERIOD_LABEL,
} from './preferencesLabels'
import { useOptionLists } from './useOptionLists'

/** 弹层里正在操作的目标：必须同时记住类别，因为三类选项共用同一套行组件。 */
type OptionTarget = { kind: OptionKind; option: AnyOption }
type EditorState = { kind: OptionKind; mode: 'create' | 'rename'; option: AnyOption | null }

/**
 * 选项页当前的层级。概览只放入口，三类清单与备份 / 存储各有自己的子屏（docs/17 §4）。
<<<<<<< HEAD
 * 用组件内状态而不是路由：项目没有路由库（docs/01），日程入口保持在底部，
 * 子屏是选项内容内部的层级。
=======
 * 用组件内状态而不是路由：项目没有路由库（docs/01），底部三个一级入口保持不变，
 * 子屏是「选项」这个二级入口内部的层级。
>>>>>>> origin/main
 */
type OptionsView = 'overview' | OptionKind | 'backup' | 'storage' | 'account'

/**
 * 选项管理页（L1）。
 * 只负责编排：读取清单、串起写入与确认弹层、组装概览与子屏。
 * 校验与落库都在服务层，失败时保留弹层内容并显示具体原因。
 */
<<<<<<< HEAD
export function PreferencesScreen({ onBack }: {
  onBack: () => void
}) {
  const [view, setView] = useState<OptionsView>('overview')
  const { lists, selectable, loading, loadError, reload } = useOptionLists(view)
  const { status, saveError, canRetry, runSave, retryLastSave, resetForDateChange } = useSaveRunner()
  const [username] = useState(() => currentUser()?.username ?? '')
=======
export function PreferencesScreen({
  onNavigate,
}: {
  onNavigate: (view: View) => void
}) {
  const { lists, selectable, loading, loadError, reload } = useOptionLists()
  const { status, saveError, canRetry, runSave, retryLastSave } = useSaveRunner()
  const [email] = useState(() => currentUser()?.email ?? '')
  const [view, setView] = useState<OptionsView>('overview')
>>>>>>> origin/main
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [pendingDisable, setPendingDisable] = useState<OptionTarget | null>(null)
  const [pendingDelete, setPendingDelete] = useState<OptionTarget | null>(null)

  /** 所有写入都经这里：成功才 reload 并让调用方关闭弹层，失败保留弹层与输入。 */
  const mutate = useCallback(
<<<<<<< HEAD
    async (action: (isCurrent: () => boolean) => Promise<unknown>): Promise<boolean> => {
      let ok = false
      await runSave(async (isCurrent) => {
        await action(isCurrent)
        if (!isCurrent()) return
        await reload()
        ok = isCurrent()
=======
    async (action: () => Promise<unknown>): Promise<boolean> => {
      let ok = false
      await runSave(async () => {
        await action()
        await reload()
        ok = true
>>>>>>> origin/main
      })
      return ok
    },
    [runSave, reload],
  )

  /**
   * 拖拽提交。服务层只有「同组内交换一位」的 `moveOption`（跨组本来就不允许），
   * 因此这里按位移逐步移动：拖了 3 位就调 3 次。
   * 这样不必为了拖拽新增一个批量重排接口，本地与云端两侧也不会出现新的行为差异
   * （门面每加一个函数，两侧都要实现且要被 check:cloud-parity 检查）。
   * 整个序列包在**一次** mutate 里，保存状态只闪一次。
   */
  const commitReorder = useCallback(
    async (kind: OptionKind, id: string, delta: number) => {
<<<<<<< HEAD
      await mutate(async (isCurrent) => {
        const step = delta > 0 ? 1 : -1
        for (let index = 0; index < Math.abs(delta); index += 1) {
          if (!isCurrent()) return
=======
      await mutate(async () => {
        const step = delta > 0 ? 1 : -1
        for (let index = 0; index < Math.abs(delta); index += 1) {
>>>>>>> origin/main
          const moved = await moveOption(kind, id, step)
          if (!moved) break
        }
      })
    },
    [mutate],
  )

  async function submitEditor(name: string, period: SupplementPeriod) {
    const target = editor
    if (!target) return
    const ok =
      target.mode === 'create'
        ? await mutate(() => createOption(target.kind, { name, period }))
        : await mutate(() => renameOption(target.kind, target.option?.id ?? '', name))
<<<<<<< HEAD
    if (ok) setEditor((current) => current === target ? null : current)
=======
    if (ok) setEditor(null)
>>>>>>> origin/main
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

  const groupsByKind: Record<OptionKind, OptionListGroup[]> = {
    food: [{ key: 'food', options: lists.food }],
    exercise: [{ key: 'exercise', options: lists.exercise }],
    supplement: SUPPLEMENT_PERIODS.map((period) => ({
      key: period,
      label: SUPPLEMENT_PERIOD_LABEL[period],
      options: lists.supplement.filter((item) => item.period === period),
      detail: () => `时段：${SUPPLEMENT_PERIOD_LABEL[period]}`,
    })),
  }

  const counts: Record<OptionKind, number> = {
    food: lists.food.length,
    supplement: lists.supplement.length,
    exercise: lists.exercise.length,
  }
  const totalOptions = counts.food + counts.supplement + counts.exercise
  const busy = status === 'saving'

  const listKind = view === 'food' || view === 'supplement' || view === 'exercise' ? view : null
  const subTitle = listKind
    ? OPTION_KIND_TITLE[listKind]
    : view === 'backup'
      ? BACKUP_TITLE
      : view === 'storage'
        ? STORAGE_TITLE
        : view === 'account'
          ? ACCOUNT_TITLE
          : ''

<<<<<<< HEAD
  function changeView(next: OptionsView) {
    resetForDateChange()
    setEditor(null)
    setPendingDisable(null)
    setPendingDelete(null)
    setView(next)
  }

  return (
    <main className="page options-page">
=======
  function openSection(section: OptionsSection) {
    setView(section)
  }

  return (
    <main className="page">
>>>>>>> origin/main
      <header className="topbar">
        {view === 'overview' ? (
          <div>
            <p className="eyebrow">幸福小Molly</p>
            <h1>选项</h1>
          </div>
        ) : (
          <div className="topbar-back">
            <button
              className="icon-button"
              type="button"
              aria-label={OPTIONS_BACK_LABEL}
<<<<<<< HEAD
              onClick={() => changeView('overview')}
=======
              onClick={() => setView('overview')}
>>>>>>> origin/main
            >
              ‹
            </button>
            <div>
              <p className="eyebrow">选项</p>
              <h1>{subTitle}</h1>
            </div>
          </div>
        )}
<<<<<<< HEAD
        <button className="secondary" type="button" onClick={() => {
          resetForDateChange()
          onBack()
        }}>返回日程</button>
      </header>

      <section className="stack page-scroll page-content">
=======
      </header>

      <section className="panel stack page-scroll">
>>>>>>> origin/main
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
            {view === 'overview' ? (
              <>
                <p className="muted">{OPTIONS_OVERVIEW_HINT}</p>
                <OptionsOverview
                  counts={counts}
                  selectable={selectable}
                  total={totalOptions}
                  busy={busy}
<<<<<<< HEAD
                  username={username}
                  onOpen={changeView}
=======
                  email={email}
                  onOpen={openSection}
>>>>>>> origin/main
                  onSeed={() => void mutate(() => seedExampleOptionsForCurrentUser())}
                />
              </>
            ) : null}

            {listKind ? (
              <OptionListScreen
                kind={listKind}
                groups={groupsByKind[listKind]}
                selectableCount={selectable[listKind]}
                busy={busy}
                onAdd={() => setEditor({ kind: listKind, mode: 'create', option: null })}
                onReorder={(id, delta) => commitReorder(listKind, id, delta)}
                onMove={(option, delta) => void mutate(() => moveOption(listKind, option.id, delta))}
                onToggleActive={(option) => void handleToggleActive({ kind: listKind, option })}
                onRename={(option) => setEditor({ kind: listKind, mode: 'rename', option })}
                onDelete={(option) => setPendingDelete({ kind: listKind, option })}
              />
            ) : null}

            {view === 'backup' ? (
<<<<<<< HEAD
              <BackupCard busy={busy} runSave={runSave} onImported={reload} onInputChange={resetForDateChange} />
=======
              <BackupCard available={supportsLocalBackup} busy={busy} runSave={runSave} onImported={reload} />
>>>>>>> origin/main
            ) : null}

            {view === 'storage' ? <StorageCard /> : null}

<<<<<<< HEAD
            {view === 'account' ? (
              <>
                <AccountCard username={username} />
                <SyncCard username={username} />
              </>
            ) : null}
=======
            {view === 'account' ? <AccountCard email={email} onSignOut={() => void signOut()} /> : null}
>>>>>>> origin/main
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

<<<<<<< HEAD
=======
      <BottomNav current="options" onNavigate={onNavigate} />
>>>>>>> origin/main
    </main>
  )
}
