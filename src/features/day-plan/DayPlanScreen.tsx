import { useEffect, useMemo, useState } from 'react'
import type { CustomTask, DailyMeal, DayMode, DayPlan } from '../../shared/types/dayPlan'
import { addDays, classifyDate, defaultModeForDate, getBusinessDateKey } from '../../shared/date/dateUtils'
import { ConfirmDialog } from '../../shared/components/ConfirmDialog'
import { signOut } from '../../services/local/authService'
import {
  copyYesterday,
  deleteCustomTask,
  listCustomTasks,
  listMeals,
  restoreDefaultDayPlan,
  saveCustomTask,
  saveMeals,
  upsertDayPlan,
} from '../../services/local/dayPlanService'
import { WeekView } from '../week/WeekView'
import { CustomTaskList } from './components/CustomTaskList'
import { DateHeading } from './components/DateHeading'
import { DayNavTabs } from './components/DayNavTabs'
import { EditorSheet, type EditorKind } from './components/EditorSheet'
import { EmptyDayHint } from './components/EmptyDayHint'
import { ExecuteList, type ExecutionTarget } from './components/ExecuteList'
import { ModeCard } from './components/ModeCard'
import { PrepList, type PrepKey } from './components/PrepList'
import { SaveStatusBar } from './components/SaveStatusBar'
import { HISTORY_READONLY_TEXT, LOADING_TEXT, MODE_SWITCH_MESSAGE } from './dayPlanLabels'
import { useDayPlanData } from './useDayPlanData'
import { useSaveRunner } from './useSaveRunner'

type View = 'day' | 'week'
type Tab = 'execute' | 'prepare'

/**
 * 单日计划页。只负责编排：持有界面状态、串起数据加载与保存、组装子组件。
 * 具体展示在 components/，数据读取在 useDayPlanData，保存状态机在 useSaveRunner。
 */
export function DayPlanScreen() {
  const today = getBusinessDateKey()
  const [view, setView] = useState<View>('day')
  const [selectedDate, setSelectedDate] = useState(today)
  const [tab, setTab] = useState<Tab>('execute')
  const [panel, setPanel] = useState<EditorKind | null>(null)
  const [editingTask, setEditingTask] = useState<CustomTask | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CustomTask | null>(null)
  const [confirmCopy, setConfirmCopy] = useState(false)
  const [pendingMode, setPendingMode] = useState<DayMode | null>(null)

  const data = useDayPlanData(selectedDate)
  const { status, saveError, canRetry, runSave, retryLastSave, resetForDateChange } = useSaveRunner()

  // 切换日期时丢弃上一次的待重试写入请求与错误提示，避免跨日期误重试。
  useEffect(() => {
    resetForDateChange()
  }, [selectedDate, resetForDateChange])

  const relation = classifyDate(selectedDate, today)
  const writable = relation !== 'history'
  const isPrepare = tab === 'prepare'
  const mode = data.plan?.mode ?? defaultModeForDate(selectedDate)

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

  const sortedMeals = useMemo(
    () => [...data.meals].sort((a, b) => a.meal_type.localeCompare(b.meal_type)),
    [data.meals],
  )

  async function ensurePlan(): Promise<DayPlan> {
    if (data.plan) return data.plan
    const created = await upsertDayPlan(selectedDate, {
      mode: defaultModeForDate(selectedDate),
      mode_override: false,
    })
    data.setPlan(created)
    return created
  }

  async function savePlan(patch: Partial<DayPlan>) {
    await runSave(async () => {
      data.setPlan(await upsertDayPlan(selectedDate, patch))
    })
  }

  async function savePanel(kind: EditorKind, payload: Record<string, unknown>) {
    await runSave(async () => {
      await ensurePlan()

      if (kind === 'meals') {
        const rows = payload.meals as Array<Pick<DailyMeal, 'meal_type' | 'plan_content' | 'note' | 'completed'>>
        data.setMeals(await saveMeals(selectedDate, rows))
      }
      if (kind === 'morning') {
        data.setPlan(await upsertDayPlan(selectedDate, { morning_focus: String(payload.morning_focus ?? '') }))
      }
      if (kind === 'exercise') {
        data.setPlan(
          await upsertDayPlan(selectedDate, {
            exercise_decision: payload.exercise_decision as DayPlan['exercise_decision'],
            exercise_content: String(payload.exercise_content ?? ''),
            exercise_note: String(payload.exercise_note ?? ''),
          }),
        )
      }
      if (kind === 'task') {
        const saved = await saveCustomTask(selectedDate, {
          id: editingTask?.id,
          task_time: String(payload.task_time),
          title: String(payload.title),
          note: String(payload.note),
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
    await savePlan({ [key]: !data.plan?.[key] } as Partial<DayPlan>)
  }

  async function toggleExecution(target: ExecutionTarget, id?: string) {
    if (!writable) return

    if (target === 'morning') {
      await savePlan({ morning_completed: !data.plan?.morning_completed })
      return
    }
    if (target === 'exercise') {
      await savePlan({ exercise_completed: !data.plan?.exercise_completed })
      return
    }
    if (target === 'meal' && id) {
      const meal = data.meals.find((item) => item.id === id)
      if (!meal) return
      await runSave(async () => {
        data.setMeals(
          await saveMeals(
            selectedDate,
            data.meals.map((item) => ({
              meal_type: item.meal_type,
              plan_content: item.plan_content,
              note: item.note,
              completed: item.id === id ? !item.completed : item.completed,
            })),
          ),
        )
      })
    }
  }

  async function toggleTask(id: string) {
    if (!writable) return
    const task = data.tasks.find((item) => item.id === id)
    if (!task) return
    await runSave(async () => {
      const saved = await saveCustomTask(selectedDate, { ...task, completed: !task.completed })
      data.setTasks((current) => current.map((item) => (item.id === id ? saved : item)))
    })
  }

  async function doCopy() {
    setConfirmCopy(false)
    await runSave(async () => {
      const copied = await copyYesterday(selectedDate)
      data.setPlan(copied)
      data.setMeals(await listMeals(copied.id))
      data.setTasks(await listCustomTasks(copied.id))
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

  if (view === 'week') {
    return (
      <WeekView
        selectedDate={selectedDate}
        onSelectDate={(date) => {
          setSelectedDate(date)
          setView('day')
        }}
        onBackToDay={() => setView('day')}
      />
    )
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">幸福小Molly</p>
          <h1>{isPrepare ? '准备明天' : '执行今天'}</h1>
        </div>
        <button className="secondary" type="button" onClick={() => void signOut()}>
          退出登录
        </button>
      </header>

      <DayNavTabs
        isPrepare={isPrepare}
        onExecuteToday={() => {
          setTab('execute')
          setSelectedDate(today)
        }}
        onPrepareTomorrow={() => {
          setTab('prepare')
          setSelectedDate(addDays(today, 1))
        }}
        onOpenWeek={() => setView('week')}
      />

      <section className="panel stack">
        <DateHeading
          relation={relation}
          selectedDate={selectedDate}
          onPrev={() => setSelectedDate(addDays(selectedDate, -1))}
          onNext={() => setSelectedDate(addDays(selectedDate, 1))}
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

            <ModeCard
              mode={mode}
              modeOverride={Boolean(data.plan?.mode_override)}
              writable={writable}
              onRequestSwitch={() => setPendingMode(mode === 'work' ? 'rest' : 'work')}
              onRestoreDefault={() => void restoreDefault()}
            />

            {mode === 'work' && isPrepare ? (
              <PrepList
                plan={data.plan}
                meals={sortedMeals}
                progress={progress}
                writable={writable}
                onToggle={(key) => void togglePrep(key)}
                onOpenEditor={(editor) => {
                  setEditingTask(null)
                  setPanel(editor)
                }}
              />
            ) : null}

            {isPrepare ? null : (
              <ExecuteList
                plan={data.plan}
                meals={sortedMeals}
                writable={writable}
                onToggle={(target, id) => void toggleExecution(target, id)}
              />
            )}

            <CustomTaskList
              tasks={data.tasks}
              writable={writable}
              onAdd={() => {
                setEditingTask(null)
                setPanel('task')
              }}
              onEdit={(task) => {
                setEditingTask(task)
                setPanel('task')
              }}
              onRequestDelete={(task) => setConfirmDelete(task)}
              onToggle={(id) => void toggleTask(id)}
            />

            {writable ? (
              <button className="secondary" type="button" onClick={() => setConfirmCopy(true)}>
                复制昨天
              </button>
            ) : null}
          </>
        )}
      </section>

      {pendingMode ? (
        <ConfirmDialog
          title="确认切换日期模式"
          description={pendingMode === 'rest' ? MODE_SWITCH_MESSAGE.toRest : MODE_SWITCH_MESSAGE.toWork}
          confirmLabel="确认切换"
          onConfirm={() => {
            const next = pendingMode
            setPendingMode(null)
            void savePlan({ mode: next, mode_override: true })
          }}
          onCancel={() => setPendingMode(null)}
        >
          <p className="muted">切换会影响该日期可见的规划内容。</p>
        </ConfirmDialog>
      ) : null}

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
          description="将覆盖三餐、晨间、健身和自定义事项内容，但不会复制准备勾选或完成状态。"
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
          plan={data.plan}
          task={editingTask}
          onCancel={() => setPanel(null)}
          onSave={(payload) => void savePanel(panel, payload)}
        />
      ) : null}
    </main>
  )
}
