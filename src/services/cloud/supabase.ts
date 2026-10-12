// Auth 与云端传输客户端，只由 services/sync/ 编排调用。
// 页面经 api 门面访问；认证与同步门面用动态 import 保持 SDK 独立分块。
// 业务写入始终走 IndexedDB，此目录不提供云端业务 Service。
// 环境变量只从 services/capabilities.ts 获取。
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
