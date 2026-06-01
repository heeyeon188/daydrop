drop policy if exists "drop_submissions_insert_active_member_self" on public.drop_submissions;
drop policy if exists "drop_submissions_insert_connected_member_self" on public.drop_submissions;
create policy "drop_submissions_insert_connected_member_self" on public.drop_submissions
for insert with check (
  user_id = auth.uid()
  and public.is_couple_member(couple_id)
  and exists (
    select 1
    from public.couples c
    where c.id = drop_submissions.couple_id
      and c.status in ('active', 'pending')
  )
  and exists (
    select 1
    from public.daily_drops dd
    where dd.id = drop_id
      and dd.couple_id = drop_submissions.couple_id
  )
);

drop policy if exists "daydrop_photos_insert_active_members" on storage.objects;
drop policy if exists "daydrop_photos_insert_connected_members" on storage.objects;
create policy "daydrop_photos_insert_connected_members" on storage.objects
for insert with check (
  bucket_id = 'daydrop-photos'
  and split_part(name, '/', 1) = 'couples'
  and public.is_couple_member(split_part(name, '/', 2)::uuid)
  and exists (
    select 1
    from public.couples c
    where c.id = split_part(name, '/', 2)::uuid
      and c.status in ('active', 'pending')
  )
  and name like ('couples/' || split_part(name, '/', 2) || '/drops/%/' || auth.uid()::text || '-%.jpg')
);
