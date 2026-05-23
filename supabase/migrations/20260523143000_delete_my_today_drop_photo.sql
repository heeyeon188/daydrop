create or replace function public.delete_my_today_drop_photo()
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_user_id uuid := auth.uid();
  v_member public.couple_members%rowtype;
  v_drop public.daily_drops%rowtype;
  v_submission public.drop_submissions%rowtype;
  v_expected_prefix text;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select *
  into v_member
  from public.couple_members
  where user_id = v_user_id
  limit 1;

  if v_member.id is null then
    raise exception 'couple_not_found';
  end if;

  select *
  into v_drop
  from public.daily_drops
  where couple_id = v_member.couple_id
    and drop_date = current_date
  limit 1;

  if v_drop.id is null then
    raise exception 'today_drop_not_found';
  end if;

  select *
  into v_submission
  from public.drop_submissions
  where drop_id = v_drop.id
    and couple_id = v_member.couple_id
    and user_id = v_user_id
  limit 1;

  if v_submission.id is null then
    raise exception 'today_photo_not_found';
  end if;

  v_expected_prefix := 'couples/' || v_member.couple_id::text || '/drops/' || v_drop.id::text || '/' || v_user_id::text || '-';

  if v_submission.storage_path not like (v_expected_prefix || '%.jpg') then
    raise exception 'invalid_storage_path';
  end if;

  delete from storage.objects
  where bucket_id = 'daydrop-photos'
    and name = v_submission.storage_path;

  delete from public.drop_submissions
  where id = v_submission.id;

  return jsonb_build_object(
    'deleted', true,
    'drop_id', v_drop.id
  );
end;
$$;

grant execute on function public.delete_my_today_drop_photo() to authenticated;
