do $$
declare
  v_expected_count int;
  v_updated_count int;
begin
  with updates(theme_key, audience, sort_order, prompt_ko, prompt_en) as (
    values
      ('friend_status_mood', 'friend', 1, '지금 내 상태를 제일 잘 보여주는 한 컷은?', 'What pic best captures your vibe right now?'),
      ('friend_status_mood', 'friend', 5, '오늘 내 상태를 한 컷으로 치면?', 'If your mood were one photo today, what would it be?'),
      ('friend_status_mood', 'friend', 9, '지금 네 상태를 한 컷으로 말하면?', 'Sum up your current vibe in one photo.'),
      ('friend_survival_items', 'friend', 1, '오늘 하루 종일 갖고 다닐 필수템은?', 'What’s your must-have today?'),
      ('friend_face_selfie', 'friend', 5, '오늘 내 헤어스타일은?', 'What’s your hair looking like today?'),
      ('friend_face_selfie', 'friend', 8, '지금 현실 고증 셀카 한 장은?', 'Send your most brutally honest selfie right now.'),
      ('friend_glowup_lazy', 'friend', 1, '오늘 갓생인 척 가능한 사진은?', 'What pic makes it look like you’ve got your life together today?'),
      ('couple_affection_heart', 'couple', 1, '무성의한데 사랑은 있는 한 컷 가능?', 'Send me a low-effort pic that still says “I love you.”'),
      ('couple_affection_heart', 'couple', 8, '표정만으로 하트 보내면?', 'Send me a heart with just your face.'),
      ('couple_selfie_face', 'couple', 4, '오늘 나한테만 보내는 셀카는?', 'Send me a selfie that’s just for me today.'),
      ('couple_selfie_face', 'couple', 15, '오늘 귀여움 보여주는 한 컷은?', 'Show me your cutest photo today.'),
      ('couple_selfie_face', 'couple', 24, '지금 제일 애인 같은 한 컷은?', 'What photo gives the strongest “I’m yours” energy right now?'),
      ('couple_miss_checkin', 'couple', 8, '오늘 애인한테만 보내는 근황 한 컷은?', 'Send me a just-for-me life update in one photo.'),
      ('couple_pose_mirror', 'couple', 5, '오늘의 커플 포즈는?', 'What’s today’s couple pose?'),
      ('common_face_checkin', 'common', 1, '오늘의 브이 한 컷?', 'Today’s peace-sign pic?'),
      ('common_face_checkin', 'common', 2, '지금 생존신고 한 컷은?', 'Send a quick proof-of-life pic.'),
      ('common_face_checkin', 'common', 3, '오늘 졸림 레벨 보여주는 한 컷은?', 'Show your sleepiness level in one photo.'),
      ('common_face_checkin', 'common', 4, '나한테만 보내는 대충 귀여운 척 한 컷은?', 'Send me one casually cute photo, just for me.'),
      ('common_face_checkin', 'common', 8, '오늘 귀찮음 MAX 표정 한 컷은?', 'Show your “too tired to care” face.'),
      ('common_current_scene', 'common', 8, '지금 주변에서 제일 너다운 건?', 'What around you feels the most like you?'),
      ('common_background_place', 'common', 22, '오늘 제일 많이 지나간 길은?', 'What route did you take the most today?'),
      ('common_background_place', 'common', 29, '지금 네가 있는 곳 티 나는 장면은?', 'What scene totally gives away where you are?'),
      ('common_save_share', 'common', 6, '오늘 제일 날 것 같은 사진은?', 'What’s your most unfiltered photo today?'),
      ('common_save_share', 'common', 11, '오늘을 제일 현실적으로 보여주는 사진은?', 'What photo captures today a little too honestly?'),
      ('common_emotional_record', 'common', 1, '오늘 나를 가장 행복하게 만든 장면은?', 'What moment made you the happiest today?'),
      ('common_emotional_record', 'common', 2, '오늘 괜히 오래 보고 싶었던 장면은?', 'What did you want to keep looking at today?'),
      ('common_emotional_record', 'common', 5, '오늘 나를 웃게 만든 작은 장면은?', 'What tiny moment made you smile today?'),
      ('common_emotional_record', 'common', 7, '오늘 그냥 지나치기 아까운 장면은?', 'What scene felt too good to just pass by?'),
      ('common_emotional_record', 'common', 8, '오늘 나를 잠깐 멈추게 한 장면은?', 'What made you stop for a second today?'),
      ('common_emotional_record', 'common', 10, '오늘 작은 위로가 된 장면은?', 'What little moment comforted you today?'),
      ('common_emotional_record', 'common', 12, '오늘 나를 살짝 설레게 한 장면은?', 'What gave you a little spark today?'),
      ('common_emotional_record', 'common', 18, '오늘 나에게 평화를 준 장면은?', 'What moment gave you a little peace today?'),
      ('common_emotional_record', 'common', 19, '오늘 나를 미소 짓게 한 장면은?', 'What moment made you smile today?'),
      ('common_emotional_record', 'common', 26, '오늘 조용히 힘이 된 장면은?', 'What quietly gave you strength today?'),
      ('common_emotional_record', 'common', 30, '오늘 끝에 가져가고 싶은 장면은?', 'What moment do you want to carry with you tonight?')
  ),
  expected as (
    select count(*) as count from updates
  ),
  updated as (
    update public.missions m
    set prompt_ko = u.prompt_ko,
        prompt_en = u.prompt_en
    from updates u
    where m.active = true
      and m.theme_key = u.theme_key
      and m.audience = u.audience
      and m.sort_order = u.sort_order
    returning m.id
  )
  select expected.count, count(updated.id)
  into v_expected_count, v_updated_count
  from expected
  left join updated on true
  group by expected.count;

  if v_updated_count <> v_expected_count then
    raise exception 'expected % mission text updates, updated %', v_expected_count, v_updated_count;
  end if;
end $$;

do $$
declare
  v_deactivated_count int;
begin
  update public.missions
  set active = false
  where active = true
    and theme_key = 'friend_live_update'
    and audience = 'friend'
    and sort_order = 7;

  get diagnostics v_deactivated_count = row_count;

  if v_deactivated_count <> 1 then
    raise exception 'expected to deactivate 1 friend_live_update mission, deactivated %', v_deactivated_count;
  end if;
end $$;

insert into public.missions (
  prompt_ko,
  prompt_en,
  mission_type,
  active,
  sort_order,
  audience,
  theme_key
)
values
  ('오늘 나를 가장 행복하게 만든 것은?', 'What made you the happiest today?', 'photo', true, 31, 'common', 'common_emotional_record'),
  ('오늘 가장 귀여운 것은?', 'What was the cutest thing you saw today?', 'photo', true, 32, 'common', 'common_emotional_record'),
  ('오늘 가장 예쁜 것은?', 'What was the prettiest thing you saw today?', 'photo', true, 33, 'common', 'common_emotional_record'),
  ('오늘 가장 사랑스러운 것은?', 'What was the sweetest thing you saw today?', 'photo', true, 34, 'common', 'common_emotional_record'),
  ('오늘 사진으로 남기고 싶었던 것은?', 'What did you want to capture today?', 'photo', true, 35, 'common', 'common_emotional_record');

do $$
declare
  v_active_count int;
  v_deleted_active_count int;
  v_added_count int;
  v_invalid_count int;
begin
  select count(*) into v_active_count
  from public.missions
  where active = true;

  if v_active_count <> 201 then
    raise exception 'expected 201 active missions after text update, found %', v_active_count;
  end if;

  select count(*) into v_deleted_active_count
  from public.missions
  where active = true
    and theme_key = 'friend_live_update'
    and audience = 'friend'
    and sort_order = 7;

  if v_deleted_active_count <> 0 then
    raise exception 'friend_live_update friend sort_order 7 is still active';
  end if;

  select count(*) into v_added_count
  from public.missions
  where active = true
    and theme_key = 'common_emotional_record'
    and audience = 'common'
    and sort_order between 31 and 35;

  if v_added_count <> 5 then
    raise exception 'expected 5 added common_emotional_record missions, found %', v_added_count;
  end if;

  select count(*) into v_invalid_count
  from public.missions
  where active = true
    and (
      audience not in ('friend', 'couple', 'common')
      or theme_key is null
      or prompt_ko is null
      or prompt_en is null
    );

  if v_invalid_count <> 0 then
    raise exception 'active mission validation failed for % rows', v_invalid_count;
  end if;
end $$;
