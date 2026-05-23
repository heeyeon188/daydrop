create or replace function public.get_my_today_drop_photo_to_delete()
returns jsonb
language plpgsql
security definer
set search_path = public
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

  return jsonb_build_object(
    'drop_id', v_drop.id,
    'storage_path', v_submission.storage_path
  );
end;
$$;

create or replace function public.delete_my_today_drop_photo_row(target_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  if coalesce(target_storage_path, '') = '' then
    raise exception 'missing_storage_path';
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

  if v_submission.storage_path <> target_storage_path then
    raise exception 'storage_path_mismatch';
  end if;

  delete from public.drop_submissions
  where id = v_submission.id;

  return jsonb_build_object(
    'deleted', true,
    'drop_id', v_drop.id,
    'storage_path', v_submission.storage_path
  );
end;
$$;

grant execute on function public.get_my_today_drop_photo_to_delete() to authenticated;
grant execute on function public.delete_my_today_drop_photo_row(text) to authenticated;

drop policy if exists "daydrop_photos_delete_own" on storage.objects;
create policy "daydrop_photos_delete_own" on storage.objects
for delete using (
  bucket_id = 'daydrop-photos'
  and split_part(name, '/', 1) = 'couples'
  and split_part(name, '/', 3) = 'drops'
  and exists (
    select 1
    from public.couple_members cm
    join public.daily_drops dd
      on dd.couple_id = cm.couple_id
    where cm.user_id = auth.uid()
      and cm.couple_id = split_part(name, '/', 2)::uuid
      and dd.drop_date = current_date
      and dd.id::text = split_part(name, '/', 4)
      and name like ('couples/' || cm.couple_id::text || '/drops/' || dd.id::text || '/' || auth.uid()::text || '-%.jpg')
  )
);
