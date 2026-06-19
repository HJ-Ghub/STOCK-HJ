-- Supabase SQL Editor에서 실행하세요.
-- 이 앱은 로그인한 사용자별로 stock_app_state 테이블에 앱 전체 데이터를 1행으로 저장합니다.

create table if not exists public.stock_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.stock_app_state enable row level security;

drop policy if exists "stock_app_state_select_own" on public.stock_app_state;
drop policy if exists "stock_app_state_insert_own" on public.stock_app_state;
drop policy if exists "stock_app_state_update_own" on public.stock_app_state;
drop policy if exists "stock_app_state_delete_own" on public.stock_app_state;

create policy "stock_app_state_select_own"
on public.stock_app_state
for select
to authenticated
using (auth.uid() = user_id);

create policy "stock_app_state_insert_own"
on public.stock_app_state
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "stock_app_state_update_own"
on public.stock_app_state
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "stock_app_state_delete_own"
on public.stock_app_state
for delete
to authenticated
using (auth.uid() = user_id);

create index if not exists stock_app_state_updated_at_idx
on public.stock_app_state (updated_at desc);
