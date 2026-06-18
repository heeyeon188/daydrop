// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

const INTERNAL_SECRET_HEADER = 'x-internal-push-secret';
const MAX_RECIPIENT_IDS_PER_REQUEST = 50;
const MAX_SEND_PUSH_ATTEMPTS = 3;
const SEND_PUSH_FUNCTION_NAME = 'send-push-notification';
const DEFAULT_TIMEZONE = 'Asia/Seoul';
const TARGET_LOCAL_HOUR = 12;
const DAILY_QUESTION_PUSH_COPY = {
  en: {
    title: "Today's question is here",
    body: 'Take a photo and share your day.',
  },
  ko: {
    title: '오늘의 질문이 도착했어요',
    body: '사진으로 답하고 오늘을 공유해보세요.',
  },
};

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
  retryingExisting: boolean;
  timezone: string;
  userId: string;
};

type ExistingDailyPushEventRow = {
  id: string;
  idempotency_key: string;
  payload: Record<string, unknown> | null;
  recipient_user_ids: string[] | null;
  status: string;
};

type SendPushResult = {
  body: Record<string, unknown> | null;
  ok: boolean;
  requestFailed?: boolean;
  status: number;
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

    const rows = (tokenRows ?? []) as PushTokenRow[];
    const candidates = collectNoonCandidates(rows, runAt);
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
          retryingExisting: createdEvent.retryingExisting,
          timezone: candidate.timezone,
          userId: candidate.userId,
        });
      }
    }

    const retryableExistingEvents = await collectRetryableExistingEvents({
      adminClient,
      excludeEventIds: new Set(createdEvents.map((event) => event.eventId)),
      now: runAt,
      tokenRows: rows,
    });

    const sendEvents = [...createdEvents, ...retryableExistingEvents];
    if (!sendEvents.length && !candidates.length) {
      return json(
        {
          ok: true,
          skipped: true,
          reason: 'no_recipients_in_local_noon_window_or_retryable_failed_events',
          checkedTokenCount: (tokenRows ?? []).length,
        },
        200
      );
    }

    if (!sendEvents.length) {
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

    const recipientUserIds = sendEvents.map((event) => event.userId);
    const eventIdByUserId = new Map<string, string>();
    for (const event of sendEvents) {
      eventIdByUserId.set(event.userId, event.eventId);
    }

    const koreanUserIdSet = await getKoreanPreferredLanguageUserIdSet(adminClient, recipientUserIds);
    const localizedRecipientGroups = groupRecipientUserIdsByLanguage(recipientUserIds, koreanUserIdSet);
    const sentUserIdSet = new Set<string>();
    const skippedUserIdSet = new Set<string>();

    for (const group of localizedRecipientGroups) {
      for (let index = 0; index < group.recipientUserIds.length; index += MAX_RECIPIENT_IDS_PER_REQUEST) {
        const chunk = group.recipientUserIds.slice(index, index + MAX_RECIPIENT_IDS_PER_REQUEST);
        const sendResult = await sendPushChunkWithRetry({
          chunk,
          internalPushSecret,
          message: DAILY_QUESTION_PUSH_COPY[group.language],
          supabaseUrl,
        });

        if (!sendResult.ok) {
          const errorMessage = buildChunkErrorMessage(sendResult);
          console.error('[Push] send-daily-question-push chunk failed', {
            status: sendResult.status,
            body: sendResult.body,
            requestFailed: sendResult.requestFailed === true,
          });
          for (const userId of chunk) {
            const eventId = eventIdByUserId.get(userId) ?? null;
            await markEventStatus(adminClient, eventId, {
              errorMessage,
              status: 'failed',
            });
          }
          return json({ error: 'push_send_failed' }, 502);
        }

        const skippedUserIds = Array.isArray(sendResult.body?.skippedUserIds)
          ? sendResult.body.skippedUserIds.filter((userId: unknown) => typeof userId === 'string')
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
        createdEventCount: createdEvents.filter((event) => !event.retryingExisting).length,
        retriedEventCount:
          createdEvents.filter((event) => event.retryingExisting).length + retryableExistingEvents.length,
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
      const { data: existingEvent, error: existingError } = await adminClient
        .from('push_notification_events')
        .select('id,status,sent_at')
        .eq('event_type', 'daily_question_ready')
        .eq('idempotency_key', candidate.idempotencyKey)
        .maybeSingle();

      if (existingError) {
        throw existingError;
      }

      const canRetry =
        existingEvent &&
        (existingEvent.status === 'pending' || existingEvent.status === 'failed') &&
        existingEvent.sent_at === null;

      if (!canRetry) {
        return { created: false as const, eventId: null, retryingExisting: false as const };
      }

      const { error: retryUpdateError } = await adminClient
        .from('push_notification_events')
        .update({
          error_message: null,
          status: 'pending',
        })
        .eq('id', existingEvent.id)
        .in('status', ['pending', 'failed'])
        .is('sent_at', null);

      if (retryUpdateError) {
        throw retryUpdateError;
      }

      return { created: true as const, eventId: existingEvent.id as string, retryingExisting: true as const };
    }
    throw error;
  }

  return { created: true as const, eventId: data.id as string, retryingExisting: false as const };
}

async function collectRetryableExistingEvents({
  adminClient,
  excludeEventIds,
  now,
  tokenRows,
}: {
  adminClient: ReturnType<typeof createClient>;
  excludeEventIds: Set<string>;
  now: Date;
  tokenRows: PushTokenRow[];
}): Promise<CreatedPushEvent[]> {
  const enabledUserIds = new Set(
    tokenRows.map((row) => (typeof row.user_id === 'string' ? row.user_id : null)).filter(Boolean)
  );
  if (enabledUserIds.size === 0) {
    return [];
  }

  const { data, error } = await adminClient
    .from('push_notification_events')
    .select('id,idempotency_key,payload,recipient_user_ids,status')
    .eq('event_type', 'daily_question_ready')
    .in('status', ['pending', 'failed'])
    .is('sent_at', null)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) {
    throw error;
  }

  const retryEvents: CreatedPushEvent[] = [];
  const seenUserLocalDate = new Set<string>();

  for (const event of (data ?? []) as ExistingDailyPushEventRow[]) {
    if (excludeEventIds.has(event.id)) {
      continue;
    }

    const userId = Array.isArray(event.recipient_user_ids) ? event.recipient_user_ids[0] : null;
    if (typeof userId !== 'string' || !enabledUserIds.has(userId)) {
      continue;
    }

    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    const timezone = typeof payload.timezone === 'string' ? payload.timezone : DEFAULT_TIMEZONE;
    if (!isValidTimeZone(timezone)) {
      continue;
    }

    const localDate = typeof payload.localDate === 'string' ? payload.localDate : null;
    const todayLocalDate = getLocalDateAndHour(now, timezone).localDate;
    if (!localDate || localDate !== todayLocalDate) {
      continue;
    }

    const dedupeKey = `${userId}:${localDate}`;
    if (seenUserLocalDate.has(dedupeKey)) {
      continue;
    }

    const { error: retryUpdateError } = await adminClient
      .from('push_notification_events')
      .update({
        error_message: null,
        status: 'pending',
      })
      .eq('id', event.id)
      .in('status', ['pending', 'failed'])
      .is('sent_at', null);

    if (retryUpdateError) {
      throw retryUpdateError;
    }

    seenUserLocalDate.add(dedupeKey);
    retryEvents.push({
      eventId: event.id,
      idempotencyKey: event.idempotency_key,
      localDate,
      retryingExisting: true,
      timezone,
      userId,
    });
  }

  return retryEvents;
}

async function sendPushChunkWithRetry({
  chunk,
  internalPushSecret,
  message,
  supabaseUrl,
}: {
  chunk: string[];
  internalPushSecret: string;
  message: {
    body: string;
    title: string;
  };
  supabaseUrl: string;
}): Promise<SendPushResult> {
  let lastResult: SendPushResult = {
    body: null,
    ok: false,
    requestFailed: true,
    status: 0,
  };

  for (let attempt = 1; attempt <= MAX_SEND_PUSH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/${SEND_PUSH_FUNCTION_NAME}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_SECRET_HEADER]: internalPushSecret,
        },
        body: JSON.stringify({
          recipientUserIds: chunk,
          title: message.title,
          body: message.body,
          data: {
            type: 'daily_question_ready',
          },
        }),
      });

      const body = await safeJson(response);
      lastResult = {
        body,
        ok: response.ok,
        status: response.status,
      };

      if (response.ok || !isRetryableStatus(response.status) || attempt === MAX_SEND_PUSH_ATTEMPTS) {
        return lastResult;
      }

      console.warn('[Push] send-push-notification retryable failure', {
        attempt,
        status: response.status,
        body,
      });
    } catch (error) {
      lastResult = {
        body: { message: error instanceof Error ? error.message : 'request_failed' },
        ok: false,
        requestFailed: true,
        status: 0,
      };

      if (attempt === MAX_SEND_PUSH_ATTEMPTS) {
        return lastResult;
      }

      console.warn('[Push] send-push-notification request retry', {
        attempt,
        error,
      });
    }

    await delay(getRetryDelayMs(attempt));
  }

  return lastResult;
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

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function getRetryDelayMs(attempt: number): number {
  return 400 * attempt;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildChunkErrorMessage(result: SendPushResult): string {
  const statusText = result.requestFailed ? 'request_failed' : `chunk_http_${result.status}`;
  const body = result.body;
  if (!body || typeof body !== 'object') {
    return statusText;
  }

  const error = typeof body.error === 'string' ? body.error : null;
  const upstreamStatus = typeof body.status === 'number' ? `expo_status_${body.status}` : null;
  const detailError =
    body.details && typeof body.details === 'object' && 'error' in body.details && typeof body.details.error === 'string'
      ? body.details.error
      : null;
  const parts = [statusText, error, upstreamStatus, detailError].filter(Boolean);
  return parts.join(':').slice(0, 500);
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
