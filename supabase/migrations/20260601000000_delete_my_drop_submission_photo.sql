create or replace function public.delete_my_drop_submission_photo_row(
  target_submission_id uuid,
  target_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_submission public.drop_submissions%rowtype;
  v_expected_prefix text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if target_submission_id is null then
    raise exception 'missing_submission_id';
  end if;

  if coalesce(target_storage_path, '') = '' then
    raise exception 'missing_storage_path';
  end if;

  select *
  into v_submission
  from public.drop_submissions
  where id = target_submission_id
    and user_id = v_user_id
  limit 1;

  if v_submission.id is null then
    raise exception 'photo_not_found';
  end if;

  v_expected_prefix := 'couples/' || v_submission.couple_id::text || '/drops/' || v_submission.drop_id::text || '/' || v_user_id::text || '-';

  if v_submission.storage_path not like (v_expected_prefix || '%.jpg') then
    raise exception 'invalid_storage_path';
  end if;

  if v_submission.storage_path <> target_storage_path then
    raise exception 'storage_path_mismatch';
  end if;

  delete from public.drop_submissions
  where id = v_submission.id
    and user_id = v_user_id;

  return jsonb_build_object(
    'deleted', true,
    'drop_id', v_submission.drop_id,
    'storage_path', v_submission.storage_path
  );
end;
$$;

grant execute on function public.delete_my_drop_submission_photo_row(uuid, text) to authenticated;
