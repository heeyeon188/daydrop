// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const INTERNAL_SECRET_HEADER = 'x-internal-push-secret';
const MAX_MESSAGES_PER_REQUEST = 100;

/*
  Test (replace placeholders, do not commit real secrets):
  curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/send-push-notification" \
    -H "Content-Type: application/json" \
    -H "x-internal-push-secret: <INTERNAL_PUSH_FUNCTION_SECRET>" \
    -d "{\"recipientUserIds\":[\"<YOUR_USER_ID>\"],\"title\":\"Test\",\"body\":\"Push check\",\"data\":{\"type\":\"manual_test\"}}"
*/

type SendPushRequest = {
  recipientUserIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

type PushTokenRow = {
  id: string;
  user_id: string;
  expo_push_token: string;
};

type ExpoPushTicket = {
  id?: string;
  status: 'ok' | 'error';
  message?: string;
  details?: {
    error?: string;
    [key: string]: unknown;
  };
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

  const internalSecret = Deno.env.get('INTERNAL_PUSH_FUNCTION_SECRET');
  if (!internalSecret) {
    return json({ error: 'missing_internal_push_secret' }, 500);
  }

  const providedSecret = req.headers.get(INTERNAL_SECRET_HEADER);
  if (providedSecret !== internalSecret) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'missing_supabase_server_config' }, 500);
  }

  let payload: SendPushRequest;
  try {
    payload = (await req.json()) as SendPushRequest;
  } catch {
    return json({ error: 'invalid_json_payload' }, 400);
  }

  if (!isValidRequestPayload(payload)) {
    return json(
      {
        error: 'invalid_payload',
        hint: 'recipientUserIds(string[]), title(string), body(string), data(object optional) are required',
      },
      400
    );
  }

  const recipientUserIds = Array.from(new Set(payload.recipientUserIds));
  if (recipientUserIds.length === 0) {
    return json({ ok: true, sentCount: 0, skippedUserIds: [], tickets: [] }, 200);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: tokenRows, error: tokenError } = await adminClient
    .from('user_push_tokens')
    .select('id,user_id,expo_push_token')
    .eq('enabled', true)
    .in('user_id', recipientUserIds);

  if (tokenError) {
    console.error('[Push] token lookup failed', tokenError);
    return json({ error: 'token_lookup_failed' }, 500);
  }

  const rows = ((tokenRows ?? []) as PushTokenRow[]).filter((row) => Boolean(row.expo_push_token));
  const tokenUserIdSet = new Set(rows.map((row) => row.user_id));
  const skippedUserIds = recipientUserIds.filter((userId) => !tokenUserIdSet.has(userId));

  if (rows.length === 0) {
    console.log('[Push] No enabled tokens found. skippedUserIds=', skippedUserIds);
    return json({ ok: true, sentCount: 0, skippedUserIds, tickets: [] }, 200);
  }

  const pushMessages = rows.map((row) => ({
    to: row.expo_push_token,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  }));

  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  const expoHeaders: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (expoAccessToken) {
    expoHeaders.Authorization = `Bearer ${expoAccessToken}`;
  }

  const allTickets: ExpoPushTicket[] = [];
  const tokensToDisable = new Set<string>();

  for (let index = 0; index < pushMessages.length; index += MAX_MESSAGES_PER_REQUEST) {
    const chunkMessages = pushMessages.slice(index, index + MAX_MESSAGES_PER_REQUEST);
    const chunkRows = rows.slice(index, index + MAX_MESSAGES_PER_REQUEST);

    const expoResponse = await fetch(EXPO_PUSH_API_URL, {
      method: 'POST',
      headers: expoHeaders,
      body: JSON.stringify(chunkMessages),
    });

    const expoResult = await safeJson(expoResponse);
    if (!expoResponse.ok) {
      console.error('[Push] Expo push API request failed', {
        status: expoResponse.status,
        body: expoResult,
      });
      return json({ error: 'expo_push_send_failed', status: expoResponse.status, details: expoResult }, 502);
    }

    const tickets = normalizeTickets(expoResult?.data);
    allTickets.push(...tickets);
    console.log('[Push] Expo push tickets', JSON.stringify(tickets));

    tickets.forEach((ticket, ticketIndex) => {
      const tokenRow = chunkRows[ticketIndex];
      if (!tokenRow) {
        return;
      }

      const detailError = ticket?.details?.error;
      const isDeviceNotRegistered = detailError === 'DeviceNotRegistered';
      const isInvalidTokenMessage =
        typeof ticket?.message === 'string' && ticket.message.toLowerCase().includes('not a valid expo push token');

      if (isDeviceNotRegistered || isInvalidTokenMessage) {
        tokensToDisable.add(tokenRow.id);
      }
    });
  }

  if (tokensToDisable.size > 0) {
    const tokenIds = Array.from(tokensToDisable);
    const { error: disableError } = await adminClient
      .from('user_push_tokens')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .in('id', tokenIds);

    if (disableError) {
      console.warn('[Push] Failed to disable invalid tokens. TODO: retry disable flow.', disableError);
    } else {
      console.log('[Push] Disabled invalid tokens', tokenIds);
    }
  }

  return json(
    {
      ok: true,
      sentCount: pushMessages.length,
      recipientCount: recipientUserIds.length,
      skippedUserIds,
      disabledTokenCount: tokensToDisable.size,
      tickets: allTickets,
    },
    200
  );
});

function isValidRequestPayload(payload: SendPushRequest | null | undefined): payload is SendPushRequest {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const hasValidUsers =
    Array.isArray(payload.recipientUserIds) &&
    payload.recipientUserIds.every((userId) => typeof userId === 'string' && userId.trim().length > 0);
  const hasValidTitle = typeof payload.title === 'string' && payload.title.trim().length > 0;
  const hasValidBody = typeof payload.body === 'string' && payload.body.trim().length > 0;
  const hasValidData = payload.data === undefined || (payload.data !== null && typeof payload.data === 'object');

  return hasValidUsers && hasValidTitle && hasValidBody && hasValidData;
}

function normalizeTickets(data: unknown): ExpoPushTicket[] {
  if (Array.isArray(data)) {
    return data as ExpoPushTicket[];
  }
  if (data && typeof data === 'object') {
    return [data as ExpoPushTicket];
  }
  return [];
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
