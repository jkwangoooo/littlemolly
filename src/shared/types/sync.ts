export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface SyncTestRecord {
  id: string
  content: string
  created_at: string
  updated_at: string
}
