// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

const INTERNAL_SECRET_HEADER = 'x-internal-push-secret';
const SEND_PUSH_FUNCTION_NAME = 'send-push-notification';
const COUPLE_EVENT_PUSH_COPY = {
  partner_connected: {
    en: {
      title: "You're connected on Daydrop",
      body: "Start sharing today's mission together.",
    },
    ko: {
      title: 'Daydrop에서 연결되었어요',
      body: '오늘의 질문을 함께 시작해보세요.',
    },
  },
  partner_photo_uploaded: {
    en: {
      title: "Partner uploaded today's photo",
      body: "Open Daydrop to unlock today's moment.",
    },
    ko: {
      title: '상대가 오늘의 사진을 올렸어요',
      body: 'Daydrop을 열고 오늘의 순간을 확인해보세요.',
    },
  },
};

type CoupleEventPayload =
  | {
      eventType: 'partner_photo_uploaded';
      coupleId: string;
      dropSubmissionId: string;
    }
  | {
      eventType: 'partner_connected';
      coupleId: string;
    };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const internalPushSecret = Deno.env.get('INTERNAL_PUSH_FUNCTION_SECRET');

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !internalPushSecret) {
    return json({ error: 'missing_server_config' }, 500);
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    return json({ error: 'missing_authorization' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return json({ error: 'not_authenticated' }, 401);
  }

  let payload: CoupleEventPayload;
  try {
    payload = (await req.json()) as CoupleEventPayload;
  } catch {
    return json({ error: 'invalid_json_payload' }, 400);
  }

  if (!isValidCoupleEventPayload(payload)) {
    return json({ error: 'invalid_payload' }, 400);
  }

  const { data: myMembership, error: membershipError } = await adminClient
    .from('couple_members')
    .select('id')
    .eq('couple_id', payload.coupleId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipError) {
    console.error('[Push] membership lookup failed', membershipError);
    return json({ error: 'membership_lookup_failed' }, 500);
  }

  if (!myMembership) {
    return json({ error: 'forbidden_not_couple_member' }, 403);
  }

  try {
    if (payload.eventType === 'partner_photo_uploaded') {
      return await handlePartnerPhotoUploaded({
        adminClient,
        internalPushSecret,
        payload,
        supabaseUrl,
        userId: user.id,
      });
    }

    return await handlePartnerConnected({
      adminClient,
      internalPushSecret,
      payload,
      supabaseUrl,
      userId: user.id,
    });
  } catch (error) {
    console.error('[Push] notify-couple-event failed', error);
    return json({ error: 'notify_couple_event_failed' }, 500);
  }
});

async function handlePartnerPhotoUploaded({
  adminClient,
  internalPushSecret,
  payload,
  supabaseUrl,
  userId,
}: {
  adminClient: ReturnType<typeof createClient>;
  internalPushSecret: string;
  payload: Extract<CoupleEventPayload, { eventType: 'partner_photo_uploaded' }>;
  supabaseUrl: string;
  userId: string;
}) {
  const { data: submission, error: submissionError } = await adminClient
    .from('drop_submissions')
    .select('id, drop_id, user_id, couple_id')
    .eq('id', payload.dropSubmissionId)
    .eq('couple_id', payload.coupleId)
    .maybeSingle();

  if (submissionError) {
    console.error('[Push] drop submission lookup failed', submissionError);
    return json({ error: 'submission_lookup_failed' }, 500);
  }

  if (!submission) {
    return json({ error: 'submission_not_found' }, 404);
  }

  if (submission.user_id !== userId) {
    return json({ error: 'forbidden_not_submission_owner' }, 403);
  }

  const { data: drop, error: dropError } = await adminClient
    .from('daily_drops')
    .select('id, mission_id')
    .eq('id', submission.drop_id)
    .maybeSingle();

  if (dropError) {
    console.error('[Push] daily drop lookup failed', dropError);
    return json({ error: 'drop_lookup_failed' }, 500);
  }

  const { data: recipients, error: recipientsError } = await adminClient
    .from('couple_members')
    .select('user_id')
    .eq('couple_id', payload.coupleId)
    .neq('user_id', submission.user_id);

  if (recipientsError) {
    console.error('[Push] recipient lookup failed', recipientsError);
    return json({ error: 'recipient_lookup_failed' }, 500);
  }

  const recipientUserIds = Array.from(new Set((recipients ?? []).map((member) => member.user_id).filter(Boolean)));
  const idempotencyKey = `drop_submission:${submission.id}`;

  const createdEvent = await createPushEventIfNew({
    adminClient,
    actorUserId: userId,
    coupleId: payload.coupleId,
    eventType: 'partner_photo_uploaded',
    idempotencyKey,
    payload: {
      type: 'partner_photo_uploaded',
      coupleId: payload.coupleId,
      missionId: drop?.mission_id ?? null,
      uploaderUserId: submission.user_id,
    },
    recipientUserIds,
  });

  if (!createdEvent.created) {
    return json({ ok: true, duplicate: true, eventType: 'partner_photo_uploaded' }, 200);
  }

  if (!recipientUserIds.length) {
    await markPushEventStatus(adminClient, createdEvent.eventId, {
      status: 'skipped',
    });
    return json({ ok: true, skipped: true, reason: 'no_recipients' }, 200);
  }

  const sendResult = await sendLocalizedPush({
    adminClient,
    data: {
      type: 'partner_photo_uploaded',
      coupleId: payload.coupleId,
      missionId: drop?.mission_id ?? null,
      uploaderUserId: submission.user_id,
    },
    internalPushSecret,
    messageByLanguage: COUPLE_EVENT_PUSH_COPY.partner_photo_uploaded,
    recipientUserIds,
    supabaseUrl,
  });

  if (!sendResult.ok) {
    await markPushEventStatus(adminClient, createdEvent.eventId, {
      errorMessage: sendResult.error,
      status: 'failed',
    });
    return json({ error: 'push_send_failed', details: sendResult.error }, 502);
  }

  await markPushEventStatus(adminClient, createdEvent.eventId, {
    status: 'sent',
  });

  return json({ ok: true, eventType: 'partner_photo_uploaded', recipients: recipientUserIds.length }, 200);
}

async function handlePartnerConnected({
  adminClient,
  internalPushSecret,
  payload,
  supabaseUrl,
  userId,
}: {
  adminClient: ReturnType<typeof createClient>;
  internalPushSecret: string;
  payload: Extract<CoupleEventPayload, { eventType: 'partner_connected' }>;
  supabaseUrl: string;
  userId: string;
}) {
  const { data: couple, error: coupleError } = await adminClient
    .from('couples')
    .select('id, status')
    .eq('id', payload.coupleId)
    .maybeSingle();

  if (coupleError) {
    console.error('[Push] couple lookup failed', coupleError);
    return json({ error: 'couple_lookup_failed' }, 500);
  }

  if (!couple) {
    return json({ error: 'couple_not_found' }, 404);
  }

  if (couple.status !== 'active') {
    return json({ ok: true, skipped: true, reason: 'couple_not_active' }, 200);
  }

  const { data: members, error: membersError } = await adminClient
    .from('couple_members')
    .select('user_id')
    .eq('couple_id', payload.coupleId);

  if (membersError) {
    console.error('[Push] couple members lookup failed', membersError);
    return json({ error: 'members_lookup_failed' }, 500);
  }

  const recipientUserIds = Array.from(new Set((members ?? []).map((member) => member.user_id).filter(Boolean)));
  const idempotencyKey = `couple:${payload.coupleId}`;

  const createdEvent = await createPushEventIfNew({
    adminClient,
    actorUserId: userId,
    coupleId: payload.coupleId,
    eventType: 'partner_connected',
    idempotencyKey,
    payload: {
      type: 'partner_connected',
      coupleId: payload.coupleId,
    },
    recipientUserIds,
  });

  if (!createdEvent.created) {
    return json({ ok: true, duplicate: true, eventType: 'partner_connected' }, 200);
  }

  if (!recipientUserIds.length) {
    await markPushEventStatus(adminClient, createdEvent.eventId, {
      status: 'skipped',
    });
    return json({ ok: true, skipped: true, reason: 'no_recipients' }, 200);
  }

  const sendResult = await sendLocalizedPush({
    adminClient,
    data: {
      type: 'partner_connected',
      coupleId: payload.coupleId,
    },
    internalPushSecret,
    messageByLanguage: COUPLE_EVENT_PUSH_COPY.partner_connected,
    recipientUserIds,
    supabaseUrl,
  });

  if (!sendResult.ok) {
    await markPushEventStatus(adminClient, createdEvent.eventId, {
      errorMessage: sendResult.error,
      status: 'failed',
    });
    return json({ error: 'push_send_failed', details: sendResult.error }, 502);
  }

  await markPushEventStatus(adminClient, createdEvent.eventId, {
    status: 'sent',
  });

  return json({ ok: true, eventType: 'partner_connected', recipients: recipientUserIds.length }, 200);
}

async function createPushEventIfNew({
  adminClient,
  actorUserId,
  coupleId,
  eventType,
  idempotencyKey,
  payload,
  recipientUserIds,
}: {
  adminClient: ReturnType<typeof createClient>;
  actorUserId: string;
  coupleId: string;
  eventType: 'partner_connected' | 'partner_photo_uploaded';
  idempotencyKey: string;
  payload: Record<string, unknown>;
  recipientUserIds: string[];
}) {
  const { data, error } = await adminClient
    .from('push_notification_events')
    .insert({
      actor_user_id: actorUserId,
      couple_id: coupleId,
      event_type: eventType,
      idempotency_key: idempotencyKey,
      payload,
      recipient_user_ids: recipientUserIds,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { created: false as const, eventId: null };
    }
    throw error;
  }

  return { created: true as const, eventId: data.id as string };
}

async function markPushEventStatus(
  adminClient: ReturnType<typeof createClient>,
  eventId: string | null,
  {
    errorMessage,
    status,
  }: {
    errorMessage?: string;
    status: 'failed' | 'sent' | 'skipped';
  }
) {
  if (!eventId) {
    return;
  }

  const updatePayload: Record<string, unknown> = {
    status,
  };
  if (status === 'sent' || status === 'skipped') {
    updatePayload.sent_at = new Date().toISOString();
    updatePayload.error_message = null;
  }
  if (status === 'failed') {
    updatePayload.error_message = errorMessage ?? 'unknown_error';
  }

  const { error } = await adminClient.from('push_notification_events').update(updatePayload).eq('id', eventId);
  if (error) {
    console.warn('[Push] Failed to update push_notification_events status', error);
  }
}

async function sendPush({
  body,
  data,
  internalPushSecret,
  recipientUserIds,
  supabaseUrl,
  title,
}: {
  body: string;
  data: Record<string, unknown>;
  internalPushSecret: string;
  recipientUserIds: string[];
  supabaseUrl: string;
  title: string;
}) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${SEND_PUSH_FUNCTION_NAME}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_SECRET_HEADER]: internalPushSecret,
      },
      body: JSON.stringify({
        recipientUserIds,
        title,
        body,
        data,
      }),
    });

    const jsonBody = await safeJson(response);
    if (!response.ok) {
      console.error('[Push] send-push-notification failed', {
        status: response.status,
        body: jsonBody,
      });
      return { ok: false as const, error: `http_${response.status}` };
    }

    console.log('[Push] send-push-notification response', jsonBody);
    return { ok: true as const };
  } catch (error) {
    console.error('[Push] send-push-notification request error', error);
    return { ok: false as const, error: 'request_failed' };
  }
}

async function sendLocalizedPush({
  adminClient,
  data,
  internalPushSecret,
  messageByLanguage,
  recipientUserIds,
  supabaseUrl,
}: {
  adminClient: ReturnType<typeof createClient>;
  data: Record<string, unknown>;
  internalPushSecret: string;
  messageByLanguage: {
    en: {
      body: string;
      title: string;
    };
    ko: {
      body: string;
      title: string;
    };
  };
  recipientUserIds: string[];
  supabaseUrl: string;
}) {
  const koreanUserIdSet = await getKoreanPreferredLanguageUserIdSet(adminClient, recipientUserIds);
  const localizedRecipientGroups = groupRecipientUserIdsByLanguage(recipientUserIds, koreanUserIdSet);

  for (const group of localizedRecipientGroups) {
    const message = messageByLanguage[group.language];
    const sendResult = await sendPush({
      body: message.body,
      data,
      internalPushSecret,
      recipientUserIds: group.recipientUserIds,
      supabaseUrl,
      title: message.title,
    });

    if (!sendResult.ok) {
      return sendResult;
    }
  }

  return { ok: true as const };
}

async function getKoreanPreferredLanguageUserIdSet(adminClient: ReturnType<typeof createClient>, userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds));
  if (!uniqueUserIds.length) {
    return new Set<string>();
  }

  const { data, error } = await adminClient
    .from('profiles')
    .select('id,preferred_language')
    .in('id', uniqueUserIds);

  if (error) {
    console.warn('[Push] preferred_language lookup failed. Falling back to English push copy.', error);
    return new Set<string>();
  }

  return new Set(
    (data ?? [])
      .filter((profile) => profile?.preferred_language === 'ko' && typeof profile.id === 'string')
      .map((profile) => profile.id)
  );
}

function groupRecipientUserIdsByLanguage(recipientUserIds: string[], koreanUserIdSet: Set<string>) {
  const groups = [
    {
      language: 'en' as const,
      recipientUserIds: recipientUserIds.filter((userId) => !koreanUserIdSet.has(userId)),
    },
    {
      language: 'ko' as const,
      recipientUserIds: recipientUserIds.filter((userId) => koreanUserIdSet.has(userId)),
    },
  ];

  return groups.filter((group) => group.recipientUserIds.length > 0);
}

function isValidCoupleEventPayload(payload: CoupleEventPayload | null | undefined): payload is CoupleEventPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  if (payload.eventType === 'partner_photo_uploaded') {
    return (
      typeof payload.coupleId === 'string' &&
      payload.coupleId.length > 0 &&
      typeof payload.dropSubmissionId === 'string' &&
      payload.dropSubmissionId.length > 0
    );
  }

  if (payload.eventType === 'partner_connected') {
    return typeof payload.coupleId === 'string' && payload.coupleId.length > 0;
  }

  return false;
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
