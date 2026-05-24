create table if not exists public.push_notification_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  idempotency_key text not null,
  couple_id uuid references public.couples(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  recipient_user_ids uuid[] not null default '{}'::uuid[],
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create unique index if not exists push_notification_events_type_key_idx
  on public.push_notification_events(event_type, idempotency_key);

create index if not exists push_notification_events_created_at_idx
  on public.push_notification_events(created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.push_notification_events'::regclass
      and conname = 'push_notification_events_event_type_check'
  ) then
    alter table public.push_notification_events
    add constraint push_notification_events_event_type_check
    check (event_type in ('partner_photo_uploaded', 'partner_connected', 'daily_question_ready'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.push_notification_events'::regclass
      and conname = 'push_notification_events_status_check'
  ) then
    alter table public.push_notification_events
    add constraint push_notification_events_status_check
    check (status in ('pending', 'sent', 'skipped', 'failed'));
  end if;
end $$;

alter table public.push_notification_events enable row level security;
