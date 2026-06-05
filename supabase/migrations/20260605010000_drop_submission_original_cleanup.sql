alter table public.drop_submissions
  add column if not exists original_deleted_at timestamptz,
  add column if not exists original_deleted_reason text;

create index if not exists drop_submissions_original_cleanup_idx
  on public.drop_submissions (submitted_at)
  where original_deleted_at is null
    and storage_path is not null
    and display_storage_path is not null;
