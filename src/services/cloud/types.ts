// 云端适配层的内部类型。本地优先阶段（L0-L5）不参与运行时，仅为 L6 迁移保留。
/** 阶段 1 用于验证云端同步链路的测试记录。 */
export interface SyncTestRecord {
  id: string
  content: string
  created_at: string
  updated_at: string
}
