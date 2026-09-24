// 云端适配层。
//
// S1 起这个目录**不再被页面或门面引用**：页面只走本地实现（见 services/capabilities.ts）。
// S3 起它是**同步层的传输通道**——只允许被 `src/services/sync/` 引用，
// 且同步门面（`api/syncService.ts`）必须用 `await import()` 转发，否则 supabase 会被打进主 chunk
// （`check:cloud-parity` 第 6 组静态断言这两条）。
// 同目录 L6 遗留的适配器（`dayPlanService` / `optionService` / `backupService` / `authService`）
// 还没有清理，属于 S4-T7 的范围。
//
// 环境变量从 `services/capabilities.ts` 取，不在这里再读一遍：变量名只写一次，
// 改一处不会漏一处。
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../capabilities'

export const supabaseConfigurationError =
  '缺少 Supabase 配置。请在 .env.local 中设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。'

export const hasSupabaseConfiguration = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase: SupabaseClient | null = hasSupabaseConfiguration
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error(supabaseConfigurationError)
  return supabase
}
