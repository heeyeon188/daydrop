alter table if exists public.user_push_tokens
add column if not exists timezone text;

create index if not exists user_push_tokens_enabled_timezone_idx
  on public.user_push_tokens(enabled, timezone);
