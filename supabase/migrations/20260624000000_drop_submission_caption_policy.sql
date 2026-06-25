alter table public.drop_submissions
  add constraint drop_submissions_note_caption_policy
  check (
    note is null
    or (
      char_length(note) <= 60
      and note !~ E'\n.*\n'
    )
  )
  not valid;

alter function public.get_or_create_today_drop()
  rename to get_or_create_today_drop_unredacted;

revoke execute on function public.get_or_create_today_drop_unredacted() from public, anon, authenticated;

create or replace function public.get_or_create_today_drop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb;
  v_submissions jsonb;
  v_unlocked boolean;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  v_payload := public.get_or_create_today_drop_unredacted();
  v_submissions := coalesce(v_payload -> 'submissions', '[]'::jsonb);

  select
    exists (
      select 1
      from jsonb_array_elements(v_submissions) submission
      where submission ->> 'user_id' = v_user_id::text
    )
    and exists (
      select 1
      from jsonb_array_elements(v_submissions) submission
      where submission ->> 'user_id' <> v_user_id::text
    )
  into v_unlocked;

  if not v_unlocked then
    select coalesce(
      jsonb_agg(
        case
          when submission ->> 'user_id' <> v_user_id::text
            then jsonb_set(submission, '{note}', 'null'::jsonb, true)
          else submission
        end
        order by submission_order
      ),
      '[]'::jsonb
    )
    into v_submissions
    from jsonb_array_elements(v_submissions) with ordinality as submissions(submission, submission_order);
  end if;

  return jsonb_set(v_payload, '{submissions}', v_submissions, true);
end;
$$;

grant execute on function public.get_or_create_today_drop() to authenticated;
