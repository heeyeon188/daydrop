create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform text not null default 'ios',
  device_id text,
  enabled boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, expo_push_token)
);

create index if not exists user_push_tokens_user_id_idx on public.user_push_tokens(user_id);

alter table public.user_push_tokens enable row level security;

grant select, insert, update, delete on public.user_push_tokens to authenticated;
grant select, insert, update, delete on public.user_push_tokens to service_role;

drop trigger if exists user_push_tokens_set_updated_at on public.user_push_tokens;
create trigger user_push_tokens_set_updated_at
before update on public.user_push_tokens
for each row execute function public.set_updated_at();

drop policy if exists "user_push_tokens_select_own" on public.user_push_tokens;
create policy "user_push_tokens_select_own" on public.user_push_tokens
for select using (auth.uid() = user_id);

drop policy if exists "user_push_tokens_insert_own" on public.user_push_tokens;
create policy "user_push_tokens_insert_own" on public.user_push_tokens
for insert with check (auth.uid() = user_id);

drop policy if exists "user_push_tokens_update_own" on public.user_push_tokens;
create policy "user_push_tokens_update_own" on public.user_push_tokens
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_push_tokens_delete_own" on public.user_push_tokens;
create policy "user_push_tokens_delete_own" on public.user_push_tokens
for delete using (auth.uid() = user_id);
