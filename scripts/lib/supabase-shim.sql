-- Supabase 兼容垫片（**只给本机验收脚本用，不是项目迁移**）。
--
-- `database/migrations/*.sql` 是写给 Supabase 的：它们假定库里已经有
-- `auth.users` 表、`auth.uid()` 函数，以及 `anon` / `authenticated` / `service_role`
-- 三个角色。裸的 PostgreSQL 一样都没有，所以直接跑会立刻失败。
--
-- 这个文件把那一层补出来，让五个迁移能在**本机真实 PostgreSQL** 上执行，
-- 从而把「SQL 只做过静态检查」变成「SQL 真的跑过」。`scripts/verify-sql.mjs`
-- 在应用任何迁移之前先执行它。
--
-- ## 它证明什么、不证明什么
--
-- 证明：迁移能按文件名顺序执行成功；表 / 索引 / 触发器 / 策略 / RPC 真的建得出来；
-- 历史日期触发器与 `molly.allow_history` 豁免真的按设计工作；
-- `import_local_backup` / `export_cloud_snapshot` 的往返真的能跑通；
-- RLS 策略在 `set role authenticated` 下真的拦得住越权查询。
--
-- 不证明：PostgREST 的 schema cache、GoTrue 的会话、Supabase 的托管配置
-- （邮箱验证、Site URL）——那些只有真实项目能验（`docs/19` §5 的 S6）。
--
-- ## `auth.uid()` 为什么这么写
--
-- 与 Supabase 官方定义同形：优先读 `request.jwt.claim.sub`（单数，旧写法），
-- 回退到 `request.jwt.claims`（JSON，新写法）。这样测试脚本既能用
-- `set local request.jwt.claim.sub = '<uuid>'` 模拟某个登录用户，
-- 也能用 `set local request.jwt.claims = '{"sub":"<uuid>"}'` 走真实那条路。

-- ---------------------------------------------------------------- 角色

-- `if not exists` 对 create role 不适用，用 do 块兜住重复执行。
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- ---------------------------------------------------------------- auth schema

create schema if not exists auth;

-- 只留迁移会用到的列。真实的 `auth.users` 宽得多，但迁移只读 `id`。
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  )
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'
  )
$$;

-- ---------------------------------------------------------------- 权限

-- 与 Supabase 一致：三个角色都能用 `auth` 这个 schema。
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
grant execute on function auth.email() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- `public` schema 的默认权限：Supabase 上 `authenticated` 对 `public` 里的表有全部
-- 表级权限，**真正的访问控制完全由 RLS 策略承担**。这一条必须照抄，
-- 否则 `set role authenticated` 之后连 RLS 都到不了，直接「permission denied for table」——
-- 那样测出来的失败是权限模型的差异，不是策略的问题，会掩盖真正的越权漏洞。
--
-- 注意 `alter default privileges` 只影响**之后**创建的对象的默认权限，
-- 所以必须在应用迁移**之前**执行（`verify-sql.mjs` 的顺序正是如此）。
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
