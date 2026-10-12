import {
  buildBackup, countRecords, parseBackup, serializeBackup, summarizeRecords,
  type BackupRecord, type BackupSummary,
} from './backupFormat'
import {
  atomicReadWrite, DB_VERSION, newId, readTransaction,
  type LocalStore, type TransactionWork,
} from './localDb'
import { sanitizeRecord, USER_DATA_STORES } from './recordSchemas'
import {
  assertWorkspaceGraph, copyWorkspaceRecords, OWNER_STORES, readWorkspaceRecords, recordOwner, selectWorkspaceRecords,
  type WorkspaceRecords,
} from './workspaceRecords'

export type LocalProfile = { id: string; username: string; created_at: string }

export type WorkspaceState = {
  id: string
  initialized: boolean
  initialized_at: string | null
  initialized_from: 'empty' | 'cloud' | 'legacy' | null
  updated_at: string
}

export type WorkspaceSyncState = {
  id: string
  enabled: boolean
  cloud_email: string | null
  device_id: string
  bound_at: string | null
  last_push_at: string | null
  last_restore_at: string | null
  last_error_message: string | null
  last_error_at: string | null
  updated_at: string
}

export type WorkspaceSyncPatch = Partial<Omit<WorkspaceSyncState, 'id'>>

export function mergeWorkspaceSyncState(
  owner: string,
  existing: WorkspaceSyncState | null,
  patch: WorkspaceSyncPatch,
): WorkspaceSyncState {
  return {
    enabled: false,
    cloud_email: null,
    device_id: newId(),
    bound_at: null,
    last_push_at: null,
    last_restore_at: null,
    last_error_message: null,
    last_error_at: null,
    ...existing,
    ...patch,
    id: owner,
    updated_at: new Date().toISOString(),
  }
}

type LegacyProfile = LocalProfile & { isolated_at: string }
type MigrationJournal = {
  id: string
  source_owner: string
  target_owner: string
  status: 'completed'
  record_count: number
  started_at: string
  completed_at: string
}

export type LegacyWorkspacePreview = {
  sourceOwner: string
  username: string
  total: number
  counts: BackupSummary['counts']
  firstDate: string | null
  lastDate: string | null
  pendingCount: number
  cloudUserId: string | null
  migratedTo: string | null
  unassignedRecordCount: number
}

const WORKSPACE_STORES: LocalStore[] = [
  ...USER_DATA_STORES, 'users', 'legacy_users', 'workspace_state', 'workspace_migrations',
]

export async function getWorkspaceState(owner: string, guard?: () => void): Promise<WorkspaceState | null> {
  return readTransaction({
    stores: ['workspace_state'],
    guard,
    read: (reader) => reader.get<WorkspaceState>('workspace_state', owner),
  })
}

/** 仅盘点隔离区，不据旧账号名或旧绑定推测目标 Auth UID。 */
export async function listLegacyWorkspaces(): Promise<LegacyWorkspacePreview[]> {
  return readTransaction({
    stores: [...WORKSPACE_STORES, 'legacy_outbox', 'legacy_sync_state'],
    read: async (reader) => {
      const [records, profiles, outbox, states, journals] = await Promise.all([
        readWorkspaceRecords(reader),
        reader.getAll<LegacyProfile>('legacy_users'),
        reader.getAll<{ local_user_id: string | null }>('legacy_outbox'),
        reader.getAll<{ id: string; cloud_user_id: string | null }>('legacy_sync_state'),
        reader.getAll<MigrationJournal>('workspace_migrations'),
      ])
      const owners = new Set(profiles.map((row) => row.id))
      const unassignedRecordCount = USER_DATA_STORES.reduce(
        (total, store) => total + (records[store] ?? [])
          .filter((row) => recordOwner(records, store, row) === null).length,
        0,
      )
      for (const store of OWNER_STORES) {
        for (const row of records[store] ?? []) {
          if (typeof row.user_id === 'string' && !profiles.some((profile) => profile.id === row.user_id)) {
            const live = await reader.get<WorkspaceState>('workspace_state', row.user_id)
            if (!live?.initialized) owners.add(row.user_id)
          }
        }
      }
      return [...owners].map((owner) => {
        const owned = selectWorkspaceRecords(records, owner, false)
        const dates = (owned.day_plans ?? []).map((row) => String(row.plan_date)).sort()
        const count = countRecords(owned)
        return {
          sourceOwner: owner,
          username: profiles.find((row) => row.id === owner)?.username ?? '',
          total: count.total,
          counts: count.counts,
          firstDate: dates[0] ?? null,
          lastDate: dates[dates.length - 1] ?? null,
          pendingCount: outbox.filter((row) => row.local_user_id === owner).length,
          cloudUserId: states.find((row) => row.id === owner)?.cloud_user_id ?? null,
          migratedTo: journals.find((row) => row.source_owner === owner)?.target_owner ?? null,
          unassignedRecordCount,
        }
      })
    },
  })
}

/** 云端已明确为空时，只初始化不含旧业务记录的目标 UID 工作区。 */
export async function prepareEmptyWorkspace(
  user: LocalProfile,
  guard: () => void,
  syncStatePatch?: WorkspaceSyncPatch,
): Promise<void> {
  const timestamp = new Date().toISOString()
  await atomicReadWrite({
    stores: [...WORKSPACE_STORES, 'sync_state'],
    track: false,
    owner: user.id,
    guard,
    read: async (reader) => ({
      records: await readWorkspaceRecords(reader),
      state: await reader.get<WorkspaceState>('workspace_state', user.id),
      syncState: await reader.get<WorkspaceSyncState>('sync_state', user.id),
    }),
    build: ({ records, state, syncState }) => {
      if (!state?.initialized && countRecords(selectWorkspaceRecords(records, user.id)).total) {
        throw new Error('该 UID 下有尚未确认归属的本地数据，请先处理工作区迁移。')
      }
      const next: WorkspaceState = state?.initialized ? state : {
        id: user.id,
        initialized: true,
        initialized_at: timestamp,
        initialized_from: 'empty',
        updated_at: timestamp,
      }
      const puts: NonNullable<TransactionWork['put']> = [
        { store: 'users', value: user },
        { store: 'workspace_state', value: next },
      ]
      if (syncStatePatch) puts.push({
        store: 'sync_state', value: mergeWorkspaceSyncState(user.id, syncState, syncStatePatch),
      })
      return { put: puts }
    },
  })
}


/**
 * 明确选择一个旧 owner 后，完整复制其图并一次提交 journal。
 * 目标有业务数据时拒绝合并，原业务记录与旧队列保留隔离。
 */
export async function migrateLegacyWorkspace(input: {
  sourceOwner: string
  targetUser: LocalProfile
  guard: () => void
}): Promise<BackupSummary> {
  const timestamp = new Date().toISOString()
  let summary: BackupSummary | null = null
  await atomicReadWrite({
    stores: WORKSPACE_STORES,
    owner: input.targetUser.id,
    guard: input.guard,
    track: false,
    read: async (reader) => ({
      records: await readWorkspaceRecords(reader),
      source: await reader.get<LegacyProfile>('legacy_users', input.sourceOwner),
      journal: await reader.getByIndex<MigrationJournal>('workspace_migrations', 'source_owner', input.sourceOwner),
      targetState: await reader.get<WorkspaceState>('workspace_state', input.targetUser.id),
    }),
    build: ({ records, source, journal, targetState }) => {
      if (journal) {
        if (journal.target_owner !== input.targetUser.id) throw new Error('旧工作区已经迁往另一个 UID。')
        if (!targetState?.initialized) throw new Error('迁移记录与目标工作区状态不一致，请先核对恢复记录。')
        summary = summarizeRecords(selectWorkspaceRecords(records, input.targetUser.id), {
          sourceUsername: input.targetUser.username, exportedAt: timestamp, dbVersion: DB_VERSION,
        })
        return {}
      }
      if (!source) throw new Error('旧工作区缺少隔离身份资料，不能推测归属后迁移。')
      const sourceRecords = selectWorkspaceRecords(records, input.sourceOwner)
      const targetRecords = selectWorkspaceRecords(records, input.targetUser.id)
      if (input.sourceOwner !== input.targetUser.id && countRecords(targetRecords).total) {
        throw new Error('目标工作区已有业务数据，需先明确冲突处理方案。')
      }
      if (input.sourceOwner === input.targetUser.id && targetState?.initialized) {
        throw new Error('该工作区已经初始化，不能再按旧身份搬迁。')
      }
      const clean: WorkspaceRecords = {}
      for (const store of USER_DATA_STORES) {
        const rows = (sourceRecords[store] ?? []).map((row) => sanitizeRecord(store, row).value)
        if (rows.length) clean[store] = rows
      }
      clean.users = [{ id: source.id, username: source.username, created_at: source.created_at }]
      const file = buildBackup({
        dbVersion: DB_VERSION, exportedAt: timestamp, sourceUsername: source.username, records: clean,
      })
      const validated = parseBackup(serializeBackup(file), DB_VERSION)
      const puts: NonNullable<TransactionWork['put']> = []
      const remapped = input.sourceOwner === input.targetUser.id
        ? validated.records
        : copyWorkspaceRecords(validated.records, records, input.targetUser.id, newId)
      for (const store of USER_DATA_STORES) {
        const rows = remapped[store] ?? []
        for (const row of rows) puts.push({ store, value: row as BackupRecord & { id: string } })
      }
      assertWorkspaceGraph(remapped, input.targetUser.id)
      const state: WorkspaceState = {
        id: input.targetUser.id, initialized: true, initialized_at: timestamp,
        initialized_from: 'legacy', updated_at: timestamp,
      }
      const nextJournal: MigrationJournal = {
        id: `legacy:${input.sourceOwner}`,
        source_owner: input.sourceOwner,
        target_owner: input.targetUser.id,
        status: 'completed',
        record_count: validated.summary.total,
        started_at: timestamp,
        completed_at: timestamp,
      }
      puts.push(
        { store: 'users', value: input.targetUser },
        { store: 'workspace_state', value: state },
        { store: 'workspace_migrations', value: nextJournal },
      )
      summary = summarizeRecords(remapped, {
        sourceUsername: source.username, exportedAt: timestamp, dbVersion: DB_VERSION,
      })
      return { put: puts }
    },
  })
  if (!summary) throw new Error('工作区迁移未完成。')
  return summary
}
