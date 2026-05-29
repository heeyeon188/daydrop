-- Reconcile missions to the final question table without touching already-applied migrations.

do $$
declare
  v_total_count int;
  v_active_count int;
  v_duplicate_active_count int;
  v_empty_active_count int;
begin
  select count(*), count(*) filter (where active = true)
  into v_total_count, v_active_count
  from public.missions;

  select count(*)
  into v_duplicate_active_count
  from (
    select audience, theme_key, sort_order
    from public.missions
    where active = true
    group by audience, theme_key, sort_order
    having count(*) > 1
  ) duplicates;

  select count(*)
  into v_empty_active_count
  from public.missions
  where active = true
    and (
      prompt_ko is null or trim(prompt_ko) = ''
      or prompt_en is null or trim(prompt_en) = ''
    );

  raise notice 'missions before reconcile: total=%, active=%, duplicate_active_keys=%, empty_active_prompts=%',
    v_total_count, v_active_count, v_duplicate_active_count, v_empty_active_count;
end $$;

create temporary table final_missions (
  audience text not null,
  theme_key text not null,
  sort_order int not null,
  prompt_ko text,
  prompt_en text,
  mission_type text not null,
  active boolean not null,
  primary key (audience, theme_key, sort_order)
) on commit drop;

insert into final_missions (audience, theme_key, sort_order, prompt_ko, prompt_en, mission_type, active)
values
    ('common', 'common_background_place', 1, '지금 네가 있는 곳의 분위기는?', 'What’s the vibe of where you are right now?', 'photo', true),
    ('common', 'common_background_place', 2, '오늘 네 하루 배경은?', 'What’s the backdrop of your day?', 'photo', true),
    ('common', 'common_background_place', 3, '지금 눈앞에 펼쳐진 장면은?', 'What’s the scene in front of you right now?', 'photo', true),
    ('common', 'common_background_place', 4, '오늘 제일 오래 머문 곳은?', 'Where did you spend the most time today?', 'photo', true),
    ('common', 'common_background_place', 5, '지금 네 시야 그대로는?', 'Show exactly what you’re seeing right now.', 'photo', true),
    ('common', 'common_background_place', 6, '오늘 가장 많이 본 풍경은?', 'What view did you see the most today?', 'photo', true),
    ('common', 'common_background_place', 7, '지금 너를 둘러싼 색감은?', 'What colors are surrounding you right now?', 'photo', true),
    ('common', 'common_background_place', 8, '오늘의 이동 중 한 장면은?', 'Show one moment from being on the move today.', 'photo', true),
    ('common', 'common_background_place', 9, '지금 제일 조용한 구석은?', 'What’s the quietest corner near you right now?', 'photo', true),
    ('common', 'common_background_place', 10, '오늘 가장 정신없는 공간은?', 'What was the most chaotic place today?', 'photo', true),
    ('common', 'common_background_place', 11, '지금 네 하루가 시작된 곳은?', 'Where did your day start?', 'photo', true),
    ('common', 'common_background_place', 12, '오늘의 현실 고증 배경은?', 'What background captures your real day best?', 'photo', true),
    ('common', 'common_background_place', 13, '지금 제일 마음에 드는 구석은?', 'What corner do you like most right now?', 'photo', true),
    ('common', 'common_background_place', 14, '오늘 그냥 지나치기 아까운 장면은?', 'What scene felt too good to just pass by today?', 'photo', true),
    ('common', 'common_background_place', 15, '지금 네 앞의 빛은?', 'What does the light in front of you look like?', 'photo', true),
    ('common', 'common_background_place', 16, '오늘 제일 감성 있어 보이는 배경은?', 'What background looked the most aesthetic today?', 'photo', true),
    ('common', 'common_background_place', 17, '지금 네 주변에서 제일 영화 같은 장면은?', 'What around you feels the most cinematic right now?', 'photo', true),
    ('common', 'common_background_place', 18, '오늘 네가 서 있는 자리의 풍경은?', 'What’s the view from where you’re standing today?', 'photo', true),
    ('common', 'common_background_place', 19, '지금 가장 생활감 있는 장면은?', 'What scene feels the most lived-in right now?', 'photo', true),
    ('common', 'common_background_place', 20, '오늘의 배경화면 후보는?', 'What could be today’s wallpaper photo?', 'photo', true),
    ('common', 'common_background_place', 21, '지금 네 하루의 무대는?', 'What’s the set of your day right now?', 'photo', true),
    ('common', 'common_background_place', 22, '오늘 제일 많이 지나간 길은?', 'What route did you take the most today?', 'photo', true),
    ('common', 'common_background_place', 23, '지금 창밖은 어떤데?', 'What’s outside your window right now?', 'photo', true),
    ('common', 'common_background_place', 24, '오늘 하늘 상태는?', 'What’s the sky doing today?', 'photo', true),
    ('common', 'common_background_place', 25, '지금 네 주변에서 제일 평화로운 장면은?', 'What’s the calmest scene around you right now?', 'photo', true),
    ('common', 'common_background_place', 26, '오늘 제일 바빠 보였던 곳은?', 'What place looked the busiest today?', 'photo', true),
    ('common', 'common_background_place', 27, '지금 여기만의 분위기는?', 'What’s the vibe that only this place has?', 'photo', true),
    ('common', 'common_background_place', 28, '오늘 네 기분이랑 어울리는 배경은?', 'What background matches your mood today?', 'photo', true),
    ('common', 'common_background_place', 29, '지금 네가 있는 곳 티 나는 장면은?', 'What scene totally gives away where you are?', 'photo', true),
    ('common', 'common_background_place', 30, '오늘 사진첩에 남길 만한 배경은?', 'What background deserves a spot in your camera roll today?', 'photo', true),
    ('common', 'common_current_scene', 1, '지금 나 대신 네 옆에 있는 건?', 'What’s next to you instead of me right now?', 'photo', true),
    ('common', 'common_current_scene', 2, '지금 네가 보고 있는 장면은?', 'What are you looking at right now?', 'photo', true),
    ('common', 'common_current_scene', 3, '지금 어디에 앉아 있어?', 'Where are you sitting right now?', 'photo', true),
    ('common', 'common_current_scene', 4, '오늘 너랑 제일 오래 붙어있을 건?', 'What’s been by your side the longest today?', 'photo', true),
    ('common', 'common_current_scene', 5, '지금 나한테 제일 보여주고 싶은 별거 아닌 건?', 'What tiny random thing do you want to show me right now?', 'photo', true),
    ('common', 'common_current_scene', 6, '지금 네 하루의 배경은?', 'What’s the background of your day right now?', 'photo', true),
    ('common', 'common_current_scene', 7, '지금 나 몰래 먹고 있는 거 있어?', 'Are you secretly eating something right now?', 'photo', true),
    ('common', 'common_current_scene', 8, '지금 주변에서 제일 너다운 건?', 'What around you feels the most like you?', 'photo', true),
    ('common', 'common_emotional_record', 1, '오늘 나를 가장 행복하게 만든 장면은?', 'What moment made you the happiest today?', 'photo', true),
    ('common', 'common_emotional_record', 2, '오늘 괜히 오래 보고 싶었던 장면은?', 'What did you want to keep looking at today?', 'photo', true),
    ('common', 'common_emotional_record', 3, '오늘 마음이 조금 편해진 순간은?', 'What moment made you feel a little lighter today?', 'photo', true),
    ('common', 'common_emotional_record', 4, '오늘 가장 귀여웠던 것은?', 'What was the cutest thing today?', 'photo', true),
    ('common', 'common_emotional_record', 5, '오늘 나를 웃게 만든 작은 장면은?', 'What tiny moment made you smile today?', 'photo', true),
    ('common', 'common_emotional_record', 6, '오늘의 가장 따뜻한 장면은?', 'What was the warmest scene today?', 'photo', true),
    ('common', 'common_emotional_record', 7, '오늘 그냥 지나치기 아까운 장면은?', 'What scene felt too good to just pass by?', 'photo', true),
    ('common', 'common_emotional_record', 8, '오늘 나를 잠깐 멈추게 한 장면은?', 'What made you stop for a second today?', 'photo', true),
    ('common', 'common_emotional_record', 9, '오늘 가장 오래 기억하고 싶은 장면은?', 'What scene do you want to remember the longest?', 'photo', true),
    ('common', 'common_emotional_record', 10, '오늘 작은 위로가 된 장면은?', 'What little moment comforted you today?', 'photo', true),
    ('common', 'common_emotional_record', 11, '오늘의 기분을 닮은 색은?', 'What color matches your mood today?', 'photo', true),
    ('common', 'common_emotional_record', 12, '오늘 나를 살짝 설레게 한 장면은?', 'What gave you a little spark today?', 'photo', true),
    ('common', 'common_emotional_record', 13, '오늘 생각보다 마음에 들었던 순간은?', 'What moment did you like more than expected today?', 'photo', true),
    ('common', 'common_emotional_record', 14, '오늘 나에게 다정했던 것은?', 'What felt kind to you today?', 'photo', true),
    ('common', 'common_emotional_record', 15, '오늘의 작은 행운은?', 'What was your little lucky moment today?', 'photo', true),
    ('common', 'common_emotional_record', 16, '오늘 나를 기분 좋게 만든 빛은?', 'What light made you feel good today?', 'photo', true),
    ('common', 'common_emotional_record', 17, '오늘 그냥 예뻐 보였던 것은?', 'What simply looked pretty today?', 'photo', true),
    ('common', 'common_emotional_record', 18, '오늘 나에게 평화를 준 장면은?', 'What moment gave you a little peace today?', 'photo', true),
    ('common', 'common_emotional_record', 19, '오늘 나를 미소 짓게 한 장면은?', 'What moment made you smile today?', 'photo', true),
    ('common', 'common_emotional_record', 20, '오늘 내 하루에 남기고 싶은 한 조각은?', 'What piece of today do you want to keep?', 'photo', true),
    ('common', 'common_emotional_record', 21, '오늘 나를 조금 더 괜찮게 만든 것은?', 'What made you feel a little more okay today?', 'photo', true),
    ('common', 'common_emotional_record', 22, '오늘의 소소한 행복은?', 'What was your small happiness today?', 'photo', true),
    ('common', 'common_emotional_record', 23, '오늘 나에게 선물 같았던 것은?', 'What felt like a little gift today?', 'photo', true),
    ('common', 'common_emotional_record', 24, '오늘 가장 나답다고 느낀 순간은?', 'When did you feel most like yourself today?', 'photo', true),
    ('common', 'common_emotional_record', 25, '오늘 괜히 사진으로 남기고 싶은 것은?', 'What did you randomly want to save as a photo today?', 'photo', true),
    ('common', 'common_emotional_record', 26, '오늘 조용히 힘이 된 장면은?', 'What quietly gave you strength today?', 'photo', true),
    ('common', 'common_emotional_record', 27, '오늘 내 마음을 가볍게 만든 것은?', 'What made your heart feel lighter today?', 'photo', true),
    ('common', 'common_emotional_record', 28, '오늘 나를 반짝이게 만든 것은?', 'What made you glow a little today?', 'photo', true),
    ('common', 'common_emotional_record', 29, '오늘 나에게 오래 남을 것 같은 장면은?', 'What scene feels like it’ll stay with you?', 'photo', true),
    ('common', 'common_emotional_record', 30, '오늘 끝에 가져가고 싶은 장면은?', 'What moment do you want to carry with you tonight?', 'photo', true),
    ('common', 'common_emotional_record', 31, '오늘 나를 가장 행복하게 만든 것은?', 'What made you the happiest today?', 'photo', true),
    ('common', 'common_emotional_record', 32, '오늘 가장 귀여운 것은?', 'What was the cutest thing you saw today?', 'photo', true),
    ('common', 'common_emotional_record', 33, '오늘 가장 예쁜 것은?', 'What was the prettiest thing you saw today?', 'photo', true),
    ('common', 'common_emotional_record', 34, '오늘 가장 사랑스러운 것은?', 'What was the sweetest thing you saw today?', 'photo', true),
    ('common', 'common_emotional_record', 35, '오늘 사진으로 남기고 싶었던 것은?', 'What did you want to capture today?', 'photo', true),
    ('common', 'common_face_checkin', 1, '오늘의 브이 한 컷?', 'Today’s peace-sign pic?', 'photo', true),
    ('common', 'common_face_checkin', 2, '지금 생존신고 한 컷은?', 'Send a quick proof-of-life pic.', 'photo', true),
    ('common', 'common_face_checkin', 3, '오늘 졸림 레벨 보여주는 한 컷은?', 'Show your sleepiness level in one photo.', 'photo', true),
    ('common', 'common_face_checkin', 4, '나한테만 보내는 대충 귀여운 척 한 컷은?', 'Send me one casually cute photo, just for me.', 'photo', true),
    ('common', 'common_face_checkin', 5, '지금 표정으로 말해. “나 살아있다”', 'Say “I’m alive” with your face.', 'photo', true),
    ('common', 'common_face_checkin', 6, '오늘 얼굴 상태 폼 좋음? 망함?', 'Is your face having a good day or not?', 'photo', true),
    ('common', 'common_face_checkin', 7, '지금 나 보면 뭐라고 할 것 같아?', 'If I saw you right now, what would I say?', 'photo', true),
    ('common', 'common_face_checkin', 8, '오늘 귀찮음 MAX 표정 한 컷은?', 'Show your “too tired to care” face.', 'photo', true),
    ('common', 'common_face_checkin', 9, '머리 상태 괜찮은 척 가능?', 'Can your hair pretend it’s fine today?', 'photo', true),
    ('common', 'common_face_checkin', 10, '지금 너 표정 약간 수상한데?', 'Your face looks a little suspicious right now.', 'photo', true),
    ('common', 'common_fun_dopamine', 1, '오늘 친구가 보면 캡처할 것 같은 사진은?', 'What photo would your friend screenshot today?', 'photo', true),
    ('common', 'common_fun_dopamine', 2, '오늘 제일 눈길 가는 한 컷은?', 'What’s the most eye-catching shot today?', 'photo', true),
    ('common', 'common_fun_dopamine', 3, '오늘 가장 큰 소비는?', 'What was your biggest purchase today?', 'photo', true),
    ('common', 'common_save_share', 1, '오늘의 무조건 저장각 사진은?', 'What photo is an instant save today?', 'photo', true),
    ('common', 'common_save_share', 2, '오늘의 스토리 올릴까 말까 고민되는 사진은?', 'What photo makes you wonder, “Should I post this?”', 'photo', true),
    ('common', 'common_save_share', 3, '오늘의 아무도 안 믿을 근황샷은?', 'What update photo would nobody believe today?', 'photo', true),
    ('common', 'common_save_share', 4, '오늘의 “이건 보내야겠다” 싶은 사진은?', 'What photo made you think, “I have to send this”?', 'photo', true),
    ('common', 'common_save_share', 5, '오늘의 제일 어이없는 한 컷은?', 'What’s the most ridiculous shot today?', 'photo', true),
    ('common', 'common_save_share', 6, '오늘 제일 날 것 같은 사진은?', 'What’s your most unfiltered photo today?', 'photo', true),
    ('common', 'common_save_share', 7, '오늘의 제일 너다운 사진은?', 'What’s the most “you” photo today?', 'photo', true),
    ('common', 'common_save_share', 8, '오늘의 단톡방 투척용 사진은?', 'What photo belongs in the group chat today?', 'photo', true),
    ('common', 'common_save_share', 9, '오늘의 놀림감 예약 사진은?', 'What photo is basically asking to get roasted?', 'photo', true),
    ('common', 'common_save_share', 10, '오늘의 웃긴데 좀 민망한 사진은?', 'What photo is funny but a little embarrassing?', 'photo', true),
    ('common', 'common_save_share', 11, '오늘을 제일 현실적으로 보여주는 사진은?', 'What photo captures today a little too honestly?', 'photo', true),
    ('couple', 'couple_affection_heart', 1, '무성의한데 사랑은 있는 한 컷 가능?', 'Send me a low-effort pic that still says “I love you.”', 'photo', true),
    ('couple', 'couple_affection_heart', 2, '오늘 나한테 보내는 하트는?', 'What heart are you sending me today?', 'photo', true),
    ('couple', 'couple_affection_heart', 3, '지금 나한테 보내는 손하트는?', 'Send me a finger heart right now.', 'photo', true),
    ('couple', 'couple_affection_heart', 4, '오늘 나한테 보내는 애정 한 컷은?', 'Send me one little love-coded photo today.', 'photo', true),
    ('couple', 'couple_affection_heart', 5, '지금 나한테 줄 수 있는 제일 작은 하트는?', 'What’s the tiniest heart you can send me right now?', 'photo', true),
    ('couple', 'couple_affection_heart', 6, '지금 나한테 보내는 애정 인증은?', 'Show me your proof of love right now.', 'photo', true),
    ('couple', 'couple_affection_heart', 7, '지금 나한테 손하트 가능해?', 'Can you send me a finger heart right now?', 'photo', true),
    ('couple', 'couple_affection_heart', 8, '표정만으로 하트 보내면?', 'Send me a heart with just your face.', 'photo', true),
    ('couple', 'couple_affection_heart', 9, '한 손하트로 생존신고 가능?', 'Can you check in with just a finger heart?', 'photo', true),
    ('couple', 'couple_affection_heart', 10, '나한테 보내는 오늘의 하트 포즈는?', 'What’s today’s heart pose for me?', 'photo', true),
    ('couple', 'couple_affection_heart', 11, '지금 손으로만 사랑 표현 가능?', 'Can you say “I love you” with just your hands?', 'photo', true),
    ('couple', 'couple_charm_crush', 1, '지금 나한테 자랑하고 싶은 포인트는?', 'What do you want to show off to me right now?', 'photo', true),
    ('couple', 'couple_charm_crush', 2, '오늘의 심쿵 포인트는?', 'What’s your little heart-skip moment today?', 'photo', true),
    ('couple', 'couple_charm_crush', 3, '손하트 말고 네가 제일 자신 있는 포즈는?', 'What pose are you most confident in, besides a finger heart?', 'photo', true),
    ('couple', 'couple_miss_checkin', 1, '지금 나한테 보내는 생존신고는?', 'Send me a little “I’m alive” check-in.', 'photo', true),
    ('couple', 'couple_miss_checkin', 2, '지금 나한테 보내는 보고싶음은?', 'Show me how much you miss me right now.', 'photo', true),
    ('couple', 'couple_miss_checkin', 3, '지금 나한테 보내는 애인 모드는?', 'Show me your partner energy right now.', 'photo', true),
    ('couple', 'couple_miss_checkin', 4, '지금 나한테 보내는 “나 여기 있어”는?', 'Send me your “I’m right here” photo.', 'photo', true),
    ('couple', 'couple_miss_checkin', 5, '오늘 나한테 보내는 “보고 싶어” 대신 한 컷은?', 'Send me one photo instead of saying “I miss you.”', 'photo', true),
    ('couple', 'couple_miss_checkin', 6, '지금 나한테 보내는 “안아줘” 느낌은?', 'Show me your “hug me” mood right now.', 'photo', true),
    ('couple', 'couple_miss_checkin', 7, '오늘 나한테만 알려주는 근황은?', 'What little update is just for me today?', 'photo', true),
    ('couple', 'couple_miss_checkin', 8, '오늘 애인한테만 보내는 근황 한 컷은?', 'Send me a just-for-me life update in one photo.', 'photo', true),
    ('couple', 'couple_pose_mirror', 1, '지금 나한테 보내는 브이는?', 'Send me your peace sign right now.', 'photo', true),
    ('couple', 'couple_pose_mirror', 2, '지금 거울샷 한 장 가능?', 'Can I get a mirror selfie right now?', 'photo', true),
    ('couple', 'couple_pose_mirror', 3, '거울샷 한 장 어때?', 'How about one mirror selfie?', 'photo', true),
    ('couple', 'couple_pose_mirror', 4, '지금 제일 자신 있는 포즈는?', 'What’s your most confident pose right now?', 'photo', true),
    ('couple', 'couple_pose_mirror', 5, '오늘의 커플 포즈는?', 'What’s today’s couple pose?', 'photo', true),
    ('couple', 'couple_selfie_face', 1, '오늘 나한테만 주는 표정은?', 'What face are you making just for me today?', 'photo', true),
    ('couple', 'couple_selfie_face', 2, '오늘 나한테 보내는 애교 한 컷은?', 'Send me one cute photo today.', 'photo', true),
    ('couple', 'couple_selfie_face', 3, '지금 나한테 보내는 귀여운 척은?', 'Show me your best fake-cute look right now.', 'photo', true),
    ('couple', 'couple_selfie_face', 4, '오늘 나한테만 보내는 셀카는?', 'Send me a selfie that’s just for me today.', 'photo', true),
    ('couple', 'couple_selfie_face', 5, '오늘 나한테 보내는 미소는?', 'Send me your smile today.', 'photo', true),
    ('couple', 'couple_selfie_face', 6, '오늘 나한테 보내는 반쪽 얼굴은?', 'Send me a half-face photo today.', 'photo', true),
    ('couple', 'couple_selfie_face', 7, '오늘 나한테만 보내는 못난 표정은?', 'Send me your ugliest cute face today.', 'photo', true),
    ('couple', 'couple_selfie_face', 8, '지금 나한테 보내는 예쁜 척은?', 'Show me your “trying to look pretty” face right now.', 'photo', true),
    ('couple', 'couple_selfie_face', 9, '오늘 나한테 보내는 대충 귀여운 한 컷은?', 'Send me a casually cute photo today.', 'photo', true),
    ('couple', 'couple_selfie_face', 10, '오늘 나한테 보여주고 싶은 네 얼굴은?', 'What face do you want me to see today?', 'photo', true),
    ('couple', 'couple_selfie_face', 11, '지금 나한테 보내는 머리 상태는?', 'Show me your hair situation right now.', 'photo', true),
    ('couple', 'couple_selfie_face', 12, '지금 나한테 보내는 졸린 얼굴은?', 'Send me your sleepy face right now.', 'photo', true),
    ('couple', 'couple_selfie_face', 13, '오늘 나한테 보내는 장난스러운 표정은?', 'Send me your playful face today.', 'photo', true),
    ('couple', 'couple_selfie_face', 14, '지금 나한테만 보내는 눈빛은?', 'What look in your eyes is just for me right now?', 'photo', true),
    ('couple', 'couple_selfie_face', 15, '오늘 귀여움 보여주는 한 컷은?', 'Show me your cutest photo today.', 'photo', true),
    ('couple', 'couple_selfie_face', 16, '오늘의 애인 전용 셀카는?', 'What’s today’s just-for-me selfie?', 'photo', true),
    ('couple', 'couple_selfie_face', 17, '오늘의 귀여운 척 어디까지 가능해?', 'How far can you push the cute act today?', 'photo', true),
    ('couple', 'couple_selfie_face', 18, '지금 얼굴 반만 나와도 되니까 한 컷 가능?', 'Can I get a photo, even if it’s just half your face?', 'photo', true),
    ('couple', 'couple_selfie_face', 19, '오늘 애교 한 방 가능?', 'Can I get one cute move from you today?', 'photo', true),
    ('couple', 'couple_selfie_face', 20, '지금 눈만 보여줘도 분위기 나오나?', 'Can you make it work with just your eyes?', 'photo', true),
    ('couple', 'couple_selfie_face', 21, '오늘 나한테만 주는 미소는?', 'What smile is just for me today?', 'photo', true),
    ('couple', 'couple_selfie_face', 22, '지금 카메라 보자마자 나오는 표정은?', 'What face do you make the second you see the camera?', 'photo', true),
    ('couple', 'couple_selfie_face', 23, '오늘 나 설레게 할 한 컷 가능?', 'Can you send me one photo that makes my heart skip?', 'photo', true),
    ('couple', 'couple_selfie_face', 24, '지금 제일 애인 같은 한 컷은?', 'What photo gives the strongest “I’m yours” energy right now?', 'photo', true),
    ('couple', 'couple_together_moment', 1, '지금 나 대신 옆에 있는 건?', 'What’s next to you instead of me right now?', 'photo', true),
    ('couple', 'couple_together_moment', 2, '오늘 나랑 같이 먹고 싶었던 건?', 'What did you wish we could eat together today?', 'photo', true),
    ('couple', 'couple_together_moment', 3, '지금 나랑 같이 보고 싶은 건?', 'What do you wish we could look at together right now?', 'photo', true),
    ('couple', 'couple_together_moment', 4, '지금 나한테 보내는 일상 한 조각은?', 'Send me a little piece of your day.', 'photo', true),
    ('couple', 'couple_together_moment', 5, '지금 같이 찍는 척 옆자리 비워줄래?', 'Leave a spot for me like we’re taking the photo together.', 'photo', true),
    ('couple', 'couple_together_moment', 6, '오늘의 커플짤 느낌 가능?', 'Can you make it feel like a couple photo today?', 'photo', true),
    ('friend', 'friend_face_selfie', 1, '지금 내 얼굴 상태 솔직히 어때?', 'Be honest. How is your face doing right now?', 'photo', true),
    ('friend', 'friend_face_selfie', 2, '지금 내 추구미랑 현실 차이는?', 'How far is your aesthetic from reality right now?', 'photo', true),
    ('friend', 'friend_face_selfie', 3, '오늘 내 패션 포인트는?', 'What’s your outfit highlight today?', 'photo', true),
    ('friend', 'friend_face_selfie', 4, '오늘 내 옷 상태 괜찮은 척 가능?', 'Can your outfit pass as intentional today?', 'photo', true),
    ('friend', 'friend_face_selfie', 5, '오늘 내 헤어스타일은?', 'What’s your hair looking like today?', 'photo', true),
    ('friend', 'friend_face_selfie', 6, '오늘 나의 귀여움 레벨은?', 'What’s your cuteness level today?', 'photo', true),
    ('friend', 'friend_face_selfie', 7, '지금 내 눈빛 상태는?', 'What’s the look in your eyes right now?', 'photo', true),
    ('friend', 'friend_face_selfie', 8, '지금 현실 고증 셀카 한 장은?', 'Send your most brutally honest selfie right now.', 'photo', true),
    ('friend', 'friend_glowup_lazy', 1, '오늘 갓생인 척 가능한 사진은?', 'What pic makes it look like you’ve got your life together today?', 'photo', true),
    ('friend', 'friend_glowup_lazy', 2, '오늘 나름 열심히 산 순간은?', 'What moment made you feel like you tried today?', 'photo', true),
    ('friend', 'friend_glowup_lazy', 3, '오늘 내가 한 일 중 제일 갓생 같은 건?', 'What’s the most got-my-life-together thing you did today?', 'photo', true),
    ('friend', 'friend_live_update', 1, '지금 가고 있는 곳은?', 'Where are you headed right now?', 'photo', true),
    ('friend', 'friend_live_update', 2, '지금 하고 있는 건?', 'What are you doing right now?', 'photo', true),
    ('friend', 'friend_live_update', 3, '지금 먹고 싶은 건?', 'What are you craving right now?', 'photo', true),
    ('friend', 'friend_live_update', 4, '지금 제일 귀찮은 건?', 'What feels the most annoying to do right now?', 'photo', true),
    ('friend', 'friend_live_update', 5, '지금 같이 있는 사람은?', 'Who are you with right now?', 'photo', true),
    ('friend', 'friend_live_update', 6, '지금 혼자 뭐 하는 중?', 'What are you doing alone right now?', 'photo', true),
    ('friend', 'friend_live_update', 7, '지금 네 손이 하고 있는 일은?', 'What are your hands doing right now?', 'photo', false),
    ('friend', 'friend_live_update', 8, '지금 네 주변 분위기는?', 'What’s the vibe around you right now?', 'photo', true),
    ('friend', 'friend_reality', 1, '지금 주변에서 제일 킹받는 물건은?', 'What’s the most annoying thing near you right now?', 'photo', true),
    ('friend', 'friend_reality', 2, '지금 제일 안 치운 티 나는 곳은?', 'What spot screams “I haven’t cleaned this yet”?', 'photo', true),
    ('friend', 'friend_reality', 3, '주변에서 제일 쓸데없는데 존재감 큰 건?', 'What’s the most useless thing around you taking up way too much attention?', 'photo', true),
    ('friend', 'friend_reality', 4, '주변에서 친구한테 놀림당할 만한 건?', 'What around you would your friend roast you for?', 'photo', true),
    ('friend', 'friend_reality', 5, '지금 내 현실을 가장 잘 보여주는 장면은?', 'What scene captures your real life best right now?', 'photo', true),
    ('friend', 'friend_reality', 6, '주변에서 제일 하찮은데 웃긴 건?', 'What’s the most random but funny thing around you?', 'photo', true),
    ('friend', 'friend_reality', 7, '주변에 “나중에 해야지” 하고 미룬 흔적은?', 'What’s something around you that screams “I’ll do it later”?', 'photo', true),
    ('friend', 'friend_reality', 8, '지금 네 앞에 있는 현실은?', 'What’s the reality sitting right in front of you?', 'photo', true),
    ('friend', 'friend_reality', 9, '지금 제일 킹받는 건?', 'What’s annoying you the most right now?', 'photo', true),
    ('friend', 'friend_reality', 10, '지금 제일 웃긴 상황은?', 'What’s the funniest thing happening right now?', 'photo', true),
    ('friend', 'friend_status_mood', 1, '지금 내 상태를 제일 잘 보여주는 한 컷은?', 'What pic best captures your vibe right now?', 'photo', true),
    ('friend', 'friend_status_mood', 2, '오늘 아침 상태를 보여줄 한 컷은?', 'Show your morning mood in one photo.', 'photo', true),
    ('friend', 'friend_status_mood', 3, '오늘의 귀찮음을 보여주는 한 컷은?', 'Show today’s laziness in one photo.', 'photo', true),
    ('friend', 'friend_status_mood', 4, '오늘 정신상태를 대신 말해줄 물건은?', 'What object sums up your mental state today?', 'photo', true),
    ('friend', 'friend_status_mood', 5, '오늘 내 상태를 한 컷으로 치면?', 'If your mood were one photo today, what would it be?', 'photo', true),
    ('friend', 'friend_status_mood', 6, '지금 내 표정이 말해주는 건?', 'What is your face saying right now?', 'photo', true),
    ('friend', 'friend_status_mood', 7, '지금 내 정신상태는?', 'What’s your mental state right now?', 'photo', true),
    ('friend', 'friend_status_mood', 8, '오늘 내 에너지 몇 퍼센트?', 'What percent is your energy at today?', 'photo', true),
    ('friend', 'friend_status_mood', 9, '지금 네 상태를 한 컷으로 말하면?', 'Sum up your current vibe in one photo.', 'photo', true),
    ('friend', 'friend_status_mood', 10, '지금 네 텐션 몇 퍼센트?', 'What’s your energy level right now?', 'photo', true),
    ('friend', 'friend_survival_items', 1, '오늘 하루 종일 갖고 다닐 필수템은?', 'What’s your must-have today?', 'photo', true),
    ('friend', 'friend_survival_items', 2, '오늘의 생존템은?', 'What’s getting you through today?', 'photo', true),
    ('friend', 'friend_survival_items', 3, '오늘의 도파민 충전템은?', 'What’s your little dopamine boost today?', 'photo', true),
    ('friend', 'friend_survival_items', 4, '오늘 하루 버티게 해줄 아이템은?', 'What item is helping you survive the day?', 'photo', true),
    ('friend', 'friend_survival_items', 5, '지금 나한테 제일 필요한 건?', 'What do you need the most right now?', 'photo', true),
    ('friend', 'friend_survival_items', 6, '지금 이 순간의 생존템은?', 'What’s your survival item at this exact moment?', 'photo', true),
    ('friend', 'friend_survival_items', 7, '지금 제일 필요한 건?', 'What do you need most right now?', 'photo', true),
    ('friend', 'friend_survival_items', 8, '오늘 너를 망칠 것 같은 유혹은?', 'What temptation might derail your day?', 'photo', true),
    ('friend', 'friend_survival_items', 9, '오늘 나를 방해하는 유혹템은?', 'What tempting thing is distracting you today?', 'photo', true);

-- Update the canonical row for each final-table key. If duplicates exist, the oldest row is canonical.
with ranked as (
  select
    m.id,
    row_number() over (partition by m.audience, m.theme_key, m.sort_order order by m.created_at asc, m.id asc) as rn
  from public.missions m
  join final_missions f
    on f.audience = m.audience
   and f.theme_key = m.theme_key
   and f.sort_order = m.sort_order
), canonical as (
  select id
  from ranked
  where rn = 1
)
update public.missions m
set prompt_ko = f.prompt_ko,
    prompt_en = f.prompt_en,
    mission_type = f.mission_type,
    active = f.active,
    audience = f.audience,
    theme_key = f.theme_key,
    sort_order = f.sort_order
from canonical c
join final_missions f on true
where m.id = c.id
  and m.audience = f.audience
  and m.theme_key = f.theme_key
  and m.sort_order = f.sort_order;

-- Insert final-table rows that are missing entirely.
insert into public.missions (prompt_ko, prompt_en, mission_type, active, sort_order, audience, theme_key)
select f.prompt_ko, f.prompt_en, f.mission_type, f.active, f.sort_order, f.audience, f.theme_key
from final_missions f
where not exists (
  select 1
  from public.missions m
  where m.audience = f.audience
    and m.theme_key = f.theme_key
    and m.sort_order = f.sort_order
);

-- Deactivate duplicate rows for final-table keys after keeping the canonical row above.
with ranked as (
  select
    m.id,
    row_number() over (partition by m.audience, m.theme_key, m.sort_order order by m.created_at asc, m.id asc) as rn
  from public.missions m
  join final_missions f
    on f.audience = m.audience
   and f.theme_key = m.theme_key
   and f.sort_order = m.sort_order
)
update public.missions m
set active = false
from ranked r
where m.id = r.id
  and r.rn > 1;

-- Anything active outside the final table must not be picked by the app.
update public.missions m
set active = false
where active = true
  and not exists (
    select 1
    from final_missions f
    where f.audience = m.audience
      and f.theme_key = m.theme_key
      and f.sort_order = m.sort_order
      and f.active = true
  );

-- The missions table is photo-only for this app surface.
update public.missions
set mission_type = 'photo'
where mission_type is distinct from 'photo';

-- Inactive blank prompt rows are intentionally left inactive and unavailable to app selection.
update public.missions
set active = false,
    mission_type = coalesce(mission_type, 'photo')
where active = true
  and (
    prompt_ko is null or trim(prompt_ko) = ''
    or prompt_en is null or trim(prompt_en) = ''
  );

do $$
declare
  v_total_count int;
  v_active_count int;
  v_invalid_count int;
  v_duplicate_active_count int;
  v_status_count int;
  v_live_active_count int;
begin
  select count(*), count(*) filter (where active = true)
  into v_total_count, v_active_count
  from public.missions;

  raise notice 'missions after reconcile: total=%, active=%', v_total_count, v_active_count;

  if v_active_count <> 201 then
    raise exception 'expected 201 active missions after reconcile, found %', v_active_count;
  end if;

  select count(*)
  into v_invalid_count
  from public.missions
  where active = true
    and (
      prompt_ko is null or trim(prompt_ko) = ''
      or prompt_en is null or trim(prompt_en) = ''
      or audience not in ('common', 'couple', 'friend')
      or theme_key is null
      or mission_type <> 'photo'
    );

  if v_invalid_count <> 0 then
    raise exception 'active mission validation failed for % rows', v_invalid_count;
  end if;

  select count(*)
  into v_duplicate_active_count
  from (
    select audience, theme_key, sort_order
    from public.missions
    where active = true
    group by audience, theme_key, sort_order
    having count(*) > 1
  ) duplicates;

  if v_duplicate_active_count <> 0 then
    raise exception 'active mission duplicate validation failed for % keys', v_duplicate_active_count;
  end if;

  select count(*)
  into v_live_active_count
  from public.missions
  where audience = 'friend'
    and theme_key = 'friend_live_update'
    and sort_order = 7
    and active = true;

  if v_live_active_count <> 0 then
    raise exception 'friend_live_update / friend / 7 must be inactive';
  end if;

  select count(*)
  into v_status_count
  from public.missions
  where audience = 'friend'
    and theme_key = 'friend_status_mood'
    and sort_order = 1
    and active = true
    and prompt_ko = '지금 내 상태를 제일 잘 보여주는 한 컷은?'
    and prompt_en = 'What pic best captures your vibe right now?'
    and mission_type = 'photo';

  if v_status_count <> 1 then
    raise exception 'friend_status_mood / friend / 1 final prompt validation failed';
  end if;
end $$;
