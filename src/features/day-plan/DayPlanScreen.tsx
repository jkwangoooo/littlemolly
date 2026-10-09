import { useEffect, useRef, useState } from 'react'
import type { CustomTask, DayMode, DayPlan } from '../../shared/types/dayPlan'
import { addDays, classifyDate, defaultModeForDate, getBusinessDateKey } from '../../shared/date/dateUtils'
import { ConfirmDialog } from '../../shared/components/ConfirmDialog'
import type { AuthResult } from '../../services/api/authService'
import {
  copyYesterday,
  deleteCustomTask,
  ensureDaySupplements,
  listCustomTasks,
  listDaySupplements,
  listExerciseItems,
  listMealItems,
  listMeals,
  restoreDefaultDayPlan,
  saveCustomTask,
  saveDaySupplements,
  saveExercise,
  saveMeals,
  setMealCompleted,
  setRoutineCompleted,
  setSupplementCompleted,
  upsertDayPlan,
} from '../../services/api/dayPlanService'
import { PreferencesScreen } from '../preferences/PreferencesScreen'
import { BubbleHeader } from './components/BubbleHeader'
import { EditorSheet, type EditorKind, type PanelPayload } from './components/EditorSheet'
import { EmptyDayHint } from './components/EmptyDayHint'
import type { ExecutionToggle } from './components/ExecuteList'

import type { PrepKey } from './components/PrepList'
import { SaveStatusBar } from './components/SaveStatusBar'
import { COMPLETION_FEEDBACK, HISTORY_READONLY_TEXT, LOADING_TEXT, MODE_SWITCH_MESSAGE, REST_NO_ROUTINE_NOTE } from './dayPlanLabels'
import { useSaveRunner } from '../../shared/hooks/useSaveRunner'
import { useDayPlanData } from './useDayPlanData'
import { BottomNav } from '../../shared/components/BottomNav'
import { buildTodayRoute, type TodayRouteNode } from './components/todayRouteModel'
import { TodayBubbleStage } from './components/TodayBubbleStage'
import { DayPlanAside } from './components/DayPlanAside'
import { FloatingPet } from '../../shared/components/FloatingPet'
import type { PetPosition } from '../../shared/components/PetMessageBubble'
import { publishFeedback } from '../../shared/feedback/feedbackBus'
import { FeedbackHost } from '../../shared/feedback/FeedbackHost'

type Tab = 'execute' | 'prepare'

/**
 * 单日计划页。只负责编排：持有界面状态、串起数据加载与保存、组装子组件。
 * 具体展示在 components/，数据读取在 useDayPlanData，保存状态机在 useSaveRunner。
 */
export function DayPlanScreen({
  authResult,
  onDismissAuthResult,
}: {
  authResult: AuthResult | null
  onDismissAuthResult: () => void
}) {
  const today = getBusinessDateKey()
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState(today)
  const [tab, setTab] = useState<Tab>('execute')
  const [panel, setPanel] = useState<EditorKind | null>(null)
  const [editingTask, setEditingTask] = useState<CustomTask | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CustomTask | null>(null)
  const [confirmCopy, setConfirmCopy] = useState(false)
  const [pendingMode, setPendingMode] = useState<DayMode | null>(null)
  const [feedbackIndex, setFeedbackIndex] = useState(0)
  const [celebrationOpen, setCelebrationOpen] = useState(false)
  const [petPosition, setPetPosition] = useState<PetPosition | null>(null)
  const [petViewport, setPetViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight, offsetLeft: window.visualViewport?.offsetLeft ?? 0, offsetTop: window.visualViewport?.offsetTop ?? 0 }))
  const navigationVersionRef = useRef(0)
  const feedbackActionIdRef = useRef(0)
  const previousSaveErrorRef = useRef<string | null>(null)

  useEffect(() => {
    const updateViewport = () => setPetViewport({
      width: window.visualViewport?.width ?? window.innerWidth,
      height: window.visualViewport?.height ?? window.innerHeight,
      offsetLeft: window.visualViewport?.offsetLeft ?? 0,
      offsetTop: window.visualViewport?.offsetTop ?? 0,
    })
    window.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('scroll', updateViewport)
    return () => {
      window.removeEventListener('resize', updateViewport)
      window.visualViewport?.removeEventListener('resize', updateViewport)
      window.visualViewport?.removeEventListener('scroll', updateViewport)
    }
  }, [])


  const data = useDayPlanData(selectedDate)
  const { status, saveError, canRetry, runSave, retryLastSave, resetForDateChange } = useSaveRunner()

  useEffect(() => {
    if (saveError && saveError !== previousSaveErrorRef.current) {
      feedbackActionIdRef.current += 1
      publishFeedback({
        type: 'save-failed',
        actionId: 'save-failed-' + feedbackActionIdRef.current,
        scope: 'day-plan',
        message: saveError,
      })
    }
    previousSaveErrorRef.current = saveError
  }, [saveError])

  // 切换日期时丢弃上一次的待重试写入请求与错误提示，避免跨日期误重试。
  useEffect(() => {
    resetForDateChange()
    previousSaveErrorRef.current = null
  }, [selectedDate, resetForDateChange])


  const relation = classifyDate(selectedDate, today)
  const writable = relation !== 'history'
  const isPrepare = tab === 'prepare'
  const mode = data.plan?.mode ?? defaultModeForDate(selectedDate)
  const route = buildTodayRoute({
    relation, prepare: isPrepare, mode, plan: data.plan,
    meals: data.meals, mealItems: data.mealItems,
    supplements: data.supplements, exerciseItems: data.exerciseItems,
    routines: data.routines, tasks: data.tasks,
  })
  const pageTitle = relation === 'today' && !isPrepare
    ? '执行今天'
    : relation === 'tomorrow' && isPrepare
      ? '准备明天'
      : isPrepare
        ? '准备计划'
        : '执行计划'

  function invalidatePageContext() {
    navigationVersionRef.current += 1
    setPendingMode(null)
    setCelebrationOpen(false)
  }

  function changeDate(offset: number) {
    invalidatePageContext()
    setSelectedDate((current) => addDays(current, offset))
  }


  // 未来空日期的引导块：明天起的未规划日期显示一次说明，用户任意一次真实写入（勾选或保存面板）
  // 都会创建当天计划，引导随之消失；它自己不落库，也不阻止用户空着不填（docs/02）。
  const showEmptyDayHint = (relation === 'tomorrow' || relation === 'future') && !data.plan

  const progress = data.plan
    ? [
        data.plan.outfit_ready,
        data.plan.meals_ready,
        data.plan.supplements_ready,
        data.plan.morning_ready,
        data.plan.exercise_ready,
      ].filter(Boolean).length
      : 0

  function showCompletionFeedback() {
    const message = COMPLETION_FEEDBACK[feedbackIndex % COMPLETION_FEEDBACK.length]
    setFeedbackIndex((current) => current + 1)
    feedbackActionIdRef.current += 1
    publishFeedback({ type: 'completion', actionId: 'completion-' + feedbackActionIdRef.current, date: selectedDate, text: message })
  }


  function toggleRouteNode(node: TodayRouteNode) {
    if (!writable || status === 'saving' || !node.completionTarget) return
    const target = node.completionTarget
    if (target.kind === 'prep') void togglePrep(target.key)
    if (target.kind === 'execution') void toggleExecution(target.toggle)
    if (target.kind === 'routine') void toggleRoutine(target.id)
    if (target.kind === 'task') void toggleTask(target.id)
  }

  function arrangeRouteNode(node: TodayRouteNode) {
    if (writable && status !== 'saving' && node.editorTarget) void openPanel(node.editorTarget)
  }

  async function ensurePlan(): Promise<DayPlan> {
    if (data.plan) return data.plan
    const created = await upsertDayPlan(selectedDate, {
      mode: defaultModeForDate(selectedDate),
      mode_override: false,
    })
    data.setPlan(created)
    return created
  }

  async function savePlan(patch: Partial<DayPlan>, completed = false) {
    await runSave(async () => {
      data.setPlan(await upsertDayPlan(selectedDate, patch))
      if (completed) showCompletionFeedback()
    })
  }

  async function saveModeSwitch(targetMode: DayMode) {
    const targetDate = selectedDate
    const sourceMode = mode
    const navigationVersion = navigationVersionRef.current

    await runSave(async () => {
      const saved = await upsertDayPlan(targetDate, { mode: targetMode, mode_override: true })
      data.setPlan(saved)
      if (
        navigationVersion !== navigationVersionRef.current
        || targetDate !== selectedDate
        || optionsOpen
        || sourceMode !== 'work'
        || targetMode !== 'rest'
      ) {
        return
      }
      feedbackActionIdRef.current += 1
      publishFeedback({
        type: 'day-mode-changed',
        actionId: 'mode-switch-' + feedbackActionIdRef.current,
        date: targetDate,
        from: sourceMode,
        to: targetMode,
        relation: classifyDate(targetDate, today),
        localSaved: true,
      })
    })
  }

  /**
   * 打开编辑面板。补剂在这里先「补齐」一次：模板里还没落到这一天的项会被写进来，
   * 让用户在面板里看到完整的今日清单。补齐只发生在打开面板时，历史日期跳过，
   * 因此打开页面本身不会改写任何已有日期（docs/02「进面板时补齐，不回填」）。
   */
  async function openPanel(kind: EditorKind) {
    setEditingTask(null)
    setPanel(kind)
    if (kind === 'supplements' && writable) {
      await runSave(async () => {
        await ensurePlan()
        data.setSupplements(await ensureDaySupplements(selectedDate))
      })
    }
  }

  async function savePanel(payload: PanelPayload) {
    await runSave(async () => {
      await ensurePlan()

      if (payload.kind === 'meals') {
        const saved = await saveMeals(selectedDate, payload.meals)
        data.setMeals(saved.meals)
        data.setMealItems(saved.items)
      }
      if (payload.kind === 'supplements') {
        data.setSupplements(await saveDaySupplements(selectedDate, payload.rows))
      }
      if (payload.kind === 'morning') {
        data.setPlan(await upsertDayPlan(selectedDate, { morning_focus: payload.morning_focus }))
      }
      if (payload.kind === 'exercise') {
        const saved = await saveExercise(selectedDate, payload.exercise)
        data.setPlan(saved.plan)
        data.setExerciseItems(saved.items)
      }
      if (payload.kind === 'task') {
        const saved = await saveCustomTask(selectedDate, {
          id: editingTask?.id,
          task_time: payload.task.task_time,
          title: payload.task.title,
          note: payload.task.note,
          completed: editingTask?.completed ?? false,
        })
        data.setTasks((current) =>
          [...current.filter((item) => item.id !== saved.id), saved].sort((a, b) =>
            a.task_time.localeCompare(b.task_time),
          ),
        )
      }

      setPanel(null)
    })
  }

  async function togglePrep(key: PrepKey) {
    if (!writable) return
    const nextCompleted = !data.plan?.[key]
    await savePlan({ [key]: nextCompleted } as Partial<DayPlan>, nextCompleted)
  }

  async function toggleExecution(toggle: ExecutionToggle) {
    if (!writable) return

    if (toggle.kind === 'morning') {
      const nextCompleted = !data.plan?.morning_completed
      await savePlan({ morning_completed: nextCompleted }, nextCompleted)
      return
    }
    if (toggle.kind === 'exercise') {
      const nextCompleted = !data.plan?.exercise_completed
      await savePlan({ exercise_completed: nextCompleted }, nextCompleted)
      return
    }

    if (toggle.kind === 'meal') {
      const meal = data.meals.find((item) => item.meal_type === toggle.mealType)
      const nextCompleted = !(meal?.completed ?? false)
      await runSave(async () => {
        data.setMeals(await setMealCompleted(selectedDate, toggle.mealType, nextCompleted))
        if (nextCompleted) showCompletionFeedback()
      })
      return
    }

    const row = data.supplements.find((item) => item.id === toggle.id)
    if (!row) return
    const nextCompleted = !row.completed
    await runSave(async () => {
      data.setSupplements(await setSupplementCompleted(selectedDate, row.id, nextCompleted))
      if (nextCompleted) showCompletionFeedback()
    })
  }

  async function toggleTask(id: string) {
    if (!writable) return
    const task = data.tasks.find((item) => item.id === id)
    if (!task) return
    const nextCompleted = !task.completed
    await runSave(async () => {
      const saved = await saveCustomTask(selectedDate, { ...task, completed: nextCompleted })
      data.setTasks((current) => current.map((item) => (item.id === id ? saved : item)))
      if (nextCompleted) showCompletionFeedback()
    })
  }

  async function toggleRoutine(id: string) {
    if (!writable) return
    const routine = data.routines.find((item) => item.id === id)
    if (!routine) return
    const nextCompleted = !routine.completed
    await runSave(async () => {
      data.setRoutines(await setRoutineCompleted(selectedDate, id, nextCompleted))
      if (nextCompleted) showCompletionFeedback()
    })
  }

  async function doCopy() {
    setConfirmCopy(false)
    await runSave(async () => {
      const copied = await copyYesterday(selectedDate)
      const [nextMeals, nextMealItems, nextSupplements, nextExerciseItems, nextTasks] = await Promise.all([
        listMeals(copied.id),
        listMealItems(copied.id),
        listDaySupplements(copied.id),
        listExerciseItems(copied.id),
        listCustomTasks(copied.id),
      ])
      data.setPlan(copied)
      data.setMeals(nextMeals)
      data.setMealItems(nextMealItems)
      data.setSupplements(nextSupplements)
      data.setExerciseItems(nextExerciseItems)
      data.setTasks(nextTasks)
    })
  }

  async function restoreDefault() {
    await runSave(async () => {
      data.setPlan(await restoreDefaultDayPlan(selectedDate, defaultModeForDate(selectedDate)))
    })
  }

  async function confirmDeleteTask(task: CustomTask) {
    setConfirmDelete(null)
    await runSave(async () => {
      await deleteCustomTask(selectedDate, task.id)
      data.setTasks((current) => current.filter((item) => item.id !== task.id))
    })
  }

  if (optionsOpen) {
    return (
      <PreferencesScreen
        onBack={() => setOptionsOpen(false)}
      />
    )
  }



  return (
    <main className="page">
      <FloatingPet onPositionChange={setPetPosition} />
      
      <header className="bubble-shell-topbar">
        <div>
          <p className="eyebrow">幸福小Molly</p>
          <h1>{pageTitle}</h1>
        </div>
        <button className="secondary bubble-options-button" type="button" onClick={() => setOptionsOpen(true)}>
          选项
        </button>
      </header>


      {authResult ? (
        <div className={`auth-result auth-result-${authResult.cloud}`} role="status">
          <span>
            {authResult.cloud === 'connected'
              ? '本地数据已可用，云端账号也已连接。'
              : authResult.cloud === 'unavailable'
                ? '本地数据已可用；当前版本未配置云端服务。'
                : '本地数据已可用；云端账号暂未连接，可在“选项 → 账号与同步”中重试。'}
          </span>
          <button className="icon-button" type="button" aria-label="关闭账号状态提示" onClick={onDismissAuthResult}>
            ×
          </button>
        </div>
      ) : null}

      {/* page-scroll：固定外壳里唯一可滚动的区域（页面本身不滚动，见 styles.css 布局段）。 */}
      <section className="page-scroll page-content">
        <div className="day-plan-layout">
          <div className="stack day-plan-main">
        <BubbleHeader
          relation={relation}
          selectedDate={selectedDate}
          mode={mode}
          modeOverride={Boolean(data.plan?.mode_override)}
          writable={writable && status !== 'saving' && !celebrationOpen}
          onPrev={() => changeDate(-1)}
          onNext={() => changeDate(1)}
          onSwitchMode={() => setPendingMode(mode === 'work' ? 'rest' : 'work')}
          onRestoreDefault={() => void restoreDefault()}
          onAddTask={() => void openPanel('task')}
        />

        <SaveStatusBar
          status={status}
          saveError={saveError}
          loadError={data.loadError}
          canRetry={canRetry}
          onRetry={() => void retryLastSave()}
        />

        {relation === 'history' ? <p className="history-note">{HISTORY_READONLY_TEXT}</p> : null}

        {data.loading ? (
          <p className="muted loading-note" role="status">
            {LOADING_TEXT}
          </p>
        ) : (
          <>
            {showEmptyDayHint ? <EmptyDayHint /> : null}



            {mode === 'rest' && data.plan?.mode_override ? (
              <p className="muted rest-note">{REST_NO_ROUTINE_NOTE}</p>
            ) : null}
            {!data.loadError ? (
              <TodayBubbleStage
                route={route}
                prepare={isPrepare && mode === 'work'}
                progress={progress}
                saving={status === 'saving'}
                saveError={saveError}
                canRetry={canRetry}
                onRetry={() => void retryLastSave()}
                onToggle={toggleRouteNode}
                onArrange={arrangeRouteNode}
                onCopyYesterday={() => setConfirmCopy(true)}
                onEditTask={(node) => {
                  if (node.task) {
                    setEditingTask(node.task)
                    setPanel('task')
                  }
                }}
                onDeleteTask={(node) => { if (node.task) setConfirmDelete(node.task) }}
              />
            ) : null}
          </>
        )}
          </div>
          <DayPlanAside route={route} prepare={isPrepare && mode === 'work'} progress={progress} saving={status === 'saving'} relation={relation} />
        </div>
      </section>


      {pendingMode ? (
        <ConfirmDialog
          title="确认切换日期模式"
          description={pendingMode === 'rest' ? MODE_SWITCH_MESSAGE.toRest : MODE_SWITCH_MESSAGE.toWork}
          confirmLabel="确认切换"
          onConfirm={() => {
            const next = pendingMode
            setPendingMode(null)
            void saveModeSwitch(next)
          }}
          onCancel={() => setPendingMode(null)}
        >
          <p className="muted">切换会影响该日期可见的规划内容。</p>
        </ConfirmDialog>
      ) : null}

      <FeedbackHost
        selectedDate={selectedDate}
        optionsOpen={optionsOpen}
        onCelebrationChange={setCelebrationOpen}
        petPosition={petPosition}
        petViewport={petViewport}
      />

      {confirmDelete ? (
        <ConfirmDialog
          title="删除事项？"
          description={`${confirmDelete.title} 将被删除。`}
          confirmLabel="确认删除"
          onConfirm={() => void confirmDeleteTask(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}

      {confirmCopy ? (
        <ConfirmDialog
          title="复制昨天的计划？"
          description="将覆盖三餐、补剂、晨间、健身和自定义事项的内容，但不会复制任何准备勾选或完成状态。"
          confirmLabel="确认覆盖"
          onConfirm={() => void doCopy()}
          onCancel={() => setConfirmCopy(false)}
        />
      ) : null}

      {panel ? (
        <EditorSheet
          key={panel}
          kind={panel}
          meals={data.meals}
          mealItems={data.mealItems}
          supplements={data.supplements}
          exerciseItems={data.exerciseItems}
          plan={data.plan}
          task={editingTask}
          writable={writable}
          saveError={saveError}
          onCancel={() => setPanel(null)}
          onSave={(payload) => void savePanel(payload)}
        />
      ) : null}

      <BottomNav
        current={isPrepare ? 'prepare' : 'execute'}
        onNavigate={(destination) => {
          invalidatePageContext()
          setTab(destination)
          setSelectedDate(destination === 'execute' ? today : addDays(today, 1))
        }}
      />
    </main>
  )
}
