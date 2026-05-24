// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

const INTERNAL_SECRET_HEADER = 'x-internal-push-secret';
const MAX_RECIPIENT_IDS_PER_REQUEST = 500;
const SEND_PUSH_FUNCTION_NAME = 'send-push-notification';
const DEFAULT_TIMEZONE = 'Asia/Seoul';
const TARGET_LOCAL_HOUR = 12;

type PushTokenRow = {
  user_id: string | null;
  timezone: string | null;
};

type CandidateRecipient = {
  idempotencyKey: string;
  localDate: string;
  timezone: string;
  userId: string;
};

type CreatedPushEvent = {
  eventId: string;
  idempotencyKey: string;
  localDate: string;
  timezone: string;
  userId: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-push-secret',
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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const internalPushSecret = Deno.env.get('INTERNAL_PUSH_FUNCTION_SECRET');

  if (!supabaseUrl || !serviceRoleKey || !internalPushSecret) {
    return json({ error: 'missing_server_config' }, 500);
  }

  const providedSecret = req.headers.get(INTERNAL_SECRET_HEADER);
  if (providedSecret !== internalPushSecret) {
    return json({ error: 'unauthorized' }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const runAt = new Date();
    const { data: tokenRows, error: tokenError } = await adminClient
      .from('user_push_tokens')
      .select('user_id,timezone')
      .eq('enabled', true);

    if (tokenError) {
      return json({ error: 'token_lookup_failed' }, 500);
    }

    const candidates = collectNoonCandidates((tokenRows ?? []) as PushTokenRow[], runAt);
    if (!candidates.length) {
      return json(
        {
          ok: true,
          skipped: true,
          reason: 'no_recipients_in_local_noon_window',
          checkedTokenCount: (tokenRows ?? []).length,
        },
        200
      );
    }

    const createdEvents: CreatedPushEvent[] = [];
    for (const candidate of candidates) {
      const createdEvent = await createEventIfNew({
        adminClient,
        candidate,
      });

      if (createdEvent.created && createdEvent.eventId) {
        createdEvents.push({
          eventId: createdEvent.eventId,
          idempotencyKey: candidate.idempotencyKey,
          localDate: candidate.localDate,
          timezone: candidate.timezone,
          userId: candidate.userId,
        });
      }
    }

    if (!createdEvents.length) {
      return json(
        {
          ok: true,
          duplicate: true,
          reason: 'already_sent_for_user_local_date',
          candidateCount: candidates.length,
        },
        200
      );
    }

    const recipientUserIds = createdEvents.map((event) => event.userId);
    const eventIdByUserId = new Map<string, string>();
    for (const event of createdEvents) {
      eventIdByUserId.set(event.userId, event.eventId);
    }

    const sentUserIdSet = new Set<string>();
    const skippedUserIdSet = new Set<string>();

    for (let index = 0; index < recipientUserIds.length; index += MAX_RECIPIENT_IDS_PER_REQUEST) {
      const chunk = recipientUserIds.slice(index, index + MAX_RECIPIENT_IDS_PER_REQUEST);
      const sendResponse = await fetch(`${supabaseUrl}/functions/v1/${SEND_PUSH_FUNCTION_NAME}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_SECRET_HEADER]: internalPushSecret,
        },
        body: JSON.stringify({
          recipientUserIds: chunk,
          title: "Today's question is here",
          body: 'Take a photo and share your day.',
          data: {
            type: 'daily_question_ready',
          },
        }),
      });

      const sendResult = await safeJson(sendResponse);
      if (!sendResponse.ok) {
        console.error('[Push] send-daily-question-push chunk failed', {
          status: sendResponse.status,
          body: sendResult,
        });
        for (const userId of chunk) {
          const eventId = eventIdByUserId.get(userId) ?? null;
          await markEventStatus(adminClient, eventId, {
            errorMessage: `chunk_http_${sendResponse.status}`,
            status: 'failed',
          });
        }
        return json({ error: 'push_send_failed' }, 502);
      }

      const skippedUserIds = Array.isArray(sendResult?.skippedUserIds)
        ? sendResult.skippedUserIds.filter((userId: unknown) => typeof userId === 'string')
        : [];
      const skippedUserIdSetForChunk = new Set<string>(skippedUserIds);

      for (const userId of chunk) {
        if (skippedUserIdSetForChunk.has(userId)) {
          skippedUserIdSet.add(userId);
        } else {
          sentUserIdSet.add(userId);
        }
      }
    }

    for (const userId of sentUserIdSet) {
      const eventId = eventIdByUserId.get(userId) ?? null;
      await markEventStatus(adminClient, eventId, { status: 'sent' });
    }

    for (const userId of skippedUserIdSet) {
      const eventId = eventIdByUserId.get(userId) ?? null;
      await markEventStatus(adminClient, eventId, { status: 'skipped' });
    }

    return json(
      {
        ok: true,
        checkedTokenCount: (tokenRows ?? []).length,
        sentRecipientCount: sentUserIdSet.size,
        skippedRecipientCount: skippedUserIdSet.size,
        createdEventCount: createdEvents.length,
      },
      200
    );
  } catch (error) {
    console.error('[Push] send-daily-question-push failed', error);
    return json({ error: 'send_daily_question_push_failed' }, 500);
  }
});

function collectNoonCandidates(tokenRows: PushTokenRow[], now: Date): CandidateRecipient[] {
  const byUserLocalDate = new Map<string, CandidateRecipient>();

  for (const row of tokenRows) {
    const userId = typeof row.user_id === 'string' ? row.user_id : null;
    if (!userId) {
      continue;
    }

    const timezoneInput = typeof row.timezone === 'string' ? row.timezone.trim() : '';
    const timezone = resolveTimezone(timezoneInput, userId);
    const { localDate, localHour } = getLocalDateAndHour(now, timezone);
    if (localHour !== TARGET_LOCAL_HOUR) {
      continue;
    }

    const dedupeKey = `${userId}:${localDate}`;
    if (byUserLocalDate.has(dedupeKey)) {
      continue;
    }

    byUserLocalDate.set(dedupeKey, {
      idempotencyKey: `daily_question_ready:${userId}:${localDate}`,
      localDate,
      timezone,
      userId,
    });
  }

  return Array.from(byUserLocalDate.values());
}

function resolveTimezone(timezoneInput: string, userId: string): string {
  if (!timezoneInput) {
    console.warn('[Push] Missing timezone in user_push_tokens. Fallback to Asia/Seoul.', { userId });
    return DEFAULT_TIMEZONE;
  }

  if (!isValidTimeZone(timezoneInput)) {
    console.warn('[Push] Invalid timezone in user_push_tokens. Fallback to Asia/Seoul.', {
      userId,
      timezone: timezoneInput,
    });
    return DEFAULT_TIMEZONE;
  }

  return timezoneInput;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getLocalDateAndHour(now: Date, timezone: string): { localDate: string; localHour: number } {
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const localHourText = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);

  const localHour = Number.parseInt(localHourText, 10);
  return {
    localDate,
    localHour: Number.isFinite(localHour) ? localHour : -1,
  };
}

async function createEventIfNew({
  adminClient,
  candidate,
}: {
  adminClient: ReturnType<typeof createClient>;
  candidate: CandidateRecipient;
}) {
  const { data, error } = await adminClient
    .from('push_notification_events')
    .insert({
      event_type: 'daily_question_ready',
      idempotency_key: candidate.idempotencyKey,
      payload: {
        type: 'daily_question_ready',
        missionDate: candidate.localDate,
        localDate: candidate.localDate,
        timezone: candidate.timezone,
      },
      recipient_user_ids: [candidate.userId],
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

async function markEventStatus(
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
    console.warn('[Push] Failed to update daily push event status', error);
  }
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
