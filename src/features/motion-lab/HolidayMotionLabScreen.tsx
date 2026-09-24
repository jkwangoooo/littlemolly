import { useCallback, useEffect, useRef, useState } from 'react'
import {
  HolidayCelebration,
  type HolidayCelebrationCloseReason,
} from '../../shared/components/HolidayCelebration'
import './holidayMotionLab.css'

type DemoMode = 'work' | 'rest'
type DemoStage = 'idle' | 'confirming' | 'saving' | 'failure' | 'celebrating'

export function HolidayMotionLabScreen() {
  const [dateKind, setDateKind] = useState<'today' | 'future'>('today')
  const [outcome, setOutcome] = useState<'success' | 'failure'>('success')
  const [reducedMotion, setReducedMotion] = useState(false)
  const [mode, setMode] = useState<DemoMode>('work')
  const [stage, setStage] = useState<DemoStage>('idle')
  const [notice, setNotice] = useState('这是独立演示数据，不会读写正式计划。')
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    document.title = 'Motion Lab · 假日揭幕'
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [])

  const dateLabel = dateKind === 'today' ? '今天' : '这一天'
  const headline = dateKind === 'today' ? '今天不上班' : '这一天不上班'

  const startSave = useCallback(() => {
    setStage('saving')
    setNotice('正在保存到本地 · 结果尚未确定')
    saveTimerRef.current = window.setTimeout(() => {
      if (outcome === 'failure') {
        setStage('failure')
        setNotice('演示保存失败 · 工作日卡片保留，未播放庆祝')
        return
      }

      setMode('rest')
      setStage('celebrating')
      setNotice('已保存到本地 · 正在播放一次庆祝演出')
    }, 720)
  }, [outcome])

  function resetDemo(message = '演示已重置，等待一次模拟确认。') {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    setMode('work')
    setStage('idle')
    setNotice(message)
  }

  function handleCelebrationClose(reason: HolidayCelebrationCloseReason) {
    setStage('idle')
    setNotice(
      reason === 'natural'
        ? '演出结束 · 真实休息日页面已露出'
        : '演出已跳过 · 本地保存结果不受影响',
    )
  }

  return (
    <main className="holiday-lab">
      <div className="holiday-lab-shell">
        <header className="holiday-lab-header">
          <div>
            <a className="holiday-lab-back" href="/">← 返回正式页面</a>
            <p className="holiday-lab-kicker">MOTION LAB / HOLIDAY REVEAL</p>
            <h1>工作日松开，<br /><em>休息日落定。</em></h1>
            <p className="holiday-lab-lede">
              A「假日揭幕」+ B「日程松绑」独立演示。所有卡片、保存和日期都只是模拟。
            </p>
          </div>
          <div className="holiday-lab-stamp" aria-hidden="true">
            <span>01</span>
            <small>LOCAL ONLY</small>
          </div>
        </header>

        <div className="holiday-lab-grid">
          <section className="holiday-lab-stage" aria-label="工作日转休息日庆祝动效实验">
            <div className="holiday-lab-stage-topline">
              <div>
                <span>SCENE / HOLIDAY</span>
                <strong data-testid="holiday-demo-stage">{stage}</strong>
              </div>
              <span className={`holiday-lab-save-dot is-${stage}`} aria-hidden="true" />
            </div>

            <div className={`holiday-demo-canvas is-${mode}`} data-mode={mode}>
              <div className="holiday-demo-topbar">
                <span>幸福小Molly</span>
                <span>{dateLabel} · 模拟日期</span>
              </div>
              <div className="holiday-demo-page">
                <span className="holiday-demo-kicker">日期类型</span>
                <div className="holiday-demo-card">
                  <div>
                    <small>模式已保存到本地</small>
                    <strong>{mode === 'work' ? '工作日' : '休息日'}</strong>
                    <span>
                      {mode === 'work' ? '衣服、三餐和晨间事项还在等你安排。' : '这一天不自动加入工作日准备项。'}
                    </span>
                  </div>
                  <i aria-hidden="true">{mode === 'work' ? '↗' : '○'}</i>
                </div>
                <div className="holiday-demo-lines" aria-hidden="true">
                  <i /><i /><i />
                </div>
              </div>
              {stage === 'saving' ? <div className="holiday-demo-saving">正在保存到本地</div> : null}
              {stage === 'failure' ? <div className="holiday-demo-error">本次模拟写入失败，旧模式保持不变</div> : null}
            </div>

            <p className="holiday-lab-notice" role="status">{notice}</p>

            <div className="holiday-lab-actions">
              <button
                type="button"
                disabled={stage === 'saving' || stage === 'celebrating' || mode === 'rest'}
                onClick={() => setStage('confirming')}
              >
                模拟确认切换
              </button>
              <button className="secondary" type="button" onClick={() => resetDemo()} disabled={stage === 'saving'}>
                重置演示
              </button>
            </div>
          </section>

          <aside className="holiday-lab-controls" aria-label="庆祝动效实验控制">
            <div className="holiday-lab-control-heading">
              <span>TEST CONTROLS</span>
              <strong>演出参数</strong>
            </div>

            <fieldset>
              <legend>成功后的文案</legend>
              <div className="holiday-lab-segmented">
                <button
                  className={dateKind === 'today' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setDateKind('today')}
                >
                  今天
                </button>
                <button
                  className={dateKind === 'future' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setDateKind('future')}
                >
                  未来日期
                </button>
              </div>
              <p>{headline}</p>
            </fieldset>

            <fieldset>
              <legend>模拟写入结果</legend>
              <div className="holiday-lab-segmented">
                <button
                  className={outcome === 'success' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setOutcome('success')}
                >
                  成功
                </button>
                <button
                  className={outcome === 'failure' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setOutcome('failure')}
                >
                  失败
                </button>
              </div>
              <p>{outcome === 'success' ? '成功后才切到休息日并播放演出。' : '失败时保留工作日卡片，不播放庆祝。'}</p>
            </fieldset>

            <label className="holiday-lab-toggle">
              <input
                type="checkbox"
                checked={reducedMotion}
                onChange={(event) => setReducedMotion(event.target.checked)}
              />
              <span>
                <strong>模拟减少动态效果</strong>
                <small>不发射彩带，不滑动卡片，立即展示静态成功状态。</small>
              </span>
            </label>

            <div className="holiday-lab-checklist">
              <span>当前实验覆盖</span>
              <p>旧卡退场 → 叠放松开 → 两侧彩带 → 休息日落定</p>
              <p>跳过 / Enter / Space / Esc 都只结束演出，不撤销保存</p>
            </div>
          </aside>
        </div>
      </div>

      {stage === 'confirming' ? (
        <div className="holiday-lab-confirm-backdrop">
          <section className="holiday-lab-confirm" role="dialog" aria-modal="true" aria-labelledby="holiday-lab-confirm-title">
            <span className="holiday-lab-kicker">SIMULATED CONFIRM</span>
            <h2 id="holiday-lab-confirm-title">把{dateLabel}改为休息日？</h2>
            <p>确认后只会改变演示中的模式，成功保存后才会出现庆祝动效。</p>
            <div className="holiday-lab-actions">
              <button type="button" onClick={startSave}>确认切换</button>
              <button className="secondary" type="button" onClick={() => resetDemo('已取消，工作日卡片没有改变。')}>取消</button>
            </div>
          </section>
        </div>
      ) : null}

      <HolidayCelebration
        open={stage === 'celebrating'}
        headline={headline}
        fromLabel="工作日"
        toLabel="休息日"
        forceReducedMotion={reducedMotion}
        onClose={handleCelebrationClose}
      />
    </main>
  )
}
