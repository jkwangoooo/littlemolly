// 云端适配层，L0-L5 期间冻结、不参与运行时。阶段 1 的同步验证服务，L6 迁移时可复用其思路。
import type { SyncTestRecord } from './types'
import { requireSupabase } from './supabase'

const tableName = 'sync_test_records'

function normalize(record: SyncTestRecord): SyncTestRecord {
  return record
}

export async function listSyncTestRecords(): Promise<SyncTestRecord[]> {
  const { data, error } = await requireSupabase()
    .from(tableName)
    .select('id, content, created_at, updated_at')
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map(normalize)
}

export async function createSyncTestRecord(content: string): Promise<SyncTestRecord> {
  const { data, error } = await requireSupabase()
    .from(tableName)
    .insert({ content })
    .select('id, content, created_at, updated_at')
    .single()

  if (error) throw error
  return normalize(data)
}

export async function updateSyncTestRecord(id: string, content: string): Promise<SyncTestRecord> {
  const { data, error } = await requireSupabase()
    .from(tableName)
    .update({ content })
    .eq('id', id)
    .select('id, content, created_at, updated_at')
    .single()

  if (error) throw error
  return normalize(data)
}
