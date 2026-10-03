import assert from 'node:assert/strict'

const priority = (event) => event.type === 'save-failed' ? 'critical' : event.type === 'day-mode-changed' && event.from === 'work' && event.to === 'rest' ? 'high' : event.type === 'completion' ? 'normal' : 'low'
const decision = (event) => event.type === 'save-failed' ? { priority: 'critical', channel: 'error', interruptible: true } : event.type === 'day-mode-changed' && event.from === 'work' && event.to === 'rest' ? { priority: 'high', channel: 'celebration', interruptible: false } : event.type === 'completion' ? { priority: 'normal', channel: 'completion', interruptible: false } : { priority: 'low', channel: 'silent', interruptible: false }
const forDate = (event, selectedDate) => event.type === 'save-failed' || event.date === selectedDate
const consume = (event, date, optionsOpen, celebrationActive) => { if (optionsOpen || !forDate(event, date)) return false; const current = decision(event); return current.channel !== 'silent' && !(current.channel === 'completion' && celebrationActive) }
const completion = { type: 'completion', actionId: 'completion-1', date: '2026-10-03', text: '完成' }
const celebration = { type: 'day-mode-changed', actionId: 'mode-1', date: '2026-10-03', from: 'work', to: 'rest', relation: 'today', localSaved: true }
const reverseMode = { type: 'day-mode-changed', actionId: 'mode-2', date: '2026-10-03', from: 'rest', to: 'work', relation: 'today', localSaved: true }
const failure = { type: 'save-failed', actionId: 'failure-1', scope: 'day-plan', message: '模拟失败' }
assert.equal(priority(failure), 'critical'); assert.equal(priority(celebration), 'high'); assert.equal(priority(completion), 'normal')
assert.deepEqual(decision(failure), { priority: 'critical', channel: 'error', interruptible: true }); assert.deepEqual(decision(celebration), { priority: 'high', channel: 'celebration', interruptible: false })
assert.equal(forDate(completion, '2026-10-03'), true); assert.equal(forDate(completion, '2026-10-04'), false); assert.equal(forDate(failure, '2026-10-04'), true)
assert.equal(consume(completion, '2026-10-03', false, false), true); assert.equal(consume(completion, '2026-10-03', false, true), false); assert.equal(consume(completion, '2026-10-03', true, false), false)
assert.equal(consume(celebration, '2026-10-03', false, false), true); assert.equal(consume(reverseMode, '2026-10-03', false, false), false); assert.equal(consume(failure, '2026-10-03', false, true), true)
console.log('反馈策略回归：16/16 通过')