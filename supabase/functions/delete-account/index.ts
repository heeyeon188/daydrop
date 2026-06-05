// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

type Submission = {
  display_storage_path: string | null;
  storage_path: string | null;
  thumbnail_storage_path: string | null;
};

type SupabaseAdminClient = ReturnType<typeof createClient>;

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('missing_server_config');
    }

    const authorization = req.headers.get('Authorization');
    if (!authorization) {
      return json({ error: 'not_authenticated' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
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

    const userId = user.id;

    await deleteMyUploadedPhotosForAccountDeletion(adminClient, userId);

    const { data: memberships, error: membershipsError } = await adminClient
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', userId);

    if (membershipsError) {
      throw membershipsError;
    }

    const coupleIds = Array.from(new Set((memberships ?? []).map((membership) => membership.couple_id).filter(Boolean)));

    await throwIfError(adminClient.from('user_push_tokens').delete().eq('user_id', userId));
    await throwIfError(adminClient.from('push_tokens').delete().eq('user_id', userId));
    await throwIfError(adminClient.from('drop_submissions').delete().eq('user_id', userId));
    await throwIfError(adminClient.from('couple_members').delete().eq('user_id', userId));
    await throwIfError(adminClient.from('profiles').delete().eq('id', userId));

    for (const coupleId of coupleIds) {
      const { count, error: countError } = await adminClient
        .from('couple_members')
        .select('id', { count: 'exact', head: true })
        .eq('couple_id', coupleId);

      if (countError) {
        throw countError;
      }

      if ((count ?? 0) === 0) {
        await throwIfError(adminClient.from('daily_drops').delete().eq('couple_id', coupleId));
        await throwIfError(adminClient.from('couples').delete().eq('id', coupleId));
      }
    }

    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      throw deleteUserError;
    }

    return json({ ok: true }, 200);
  } catch (error) {
    console.error('delete-account failed', error);
    return json({ error: 'delete_account_failed' }, 500);
  }
});

async function throwIfError<T>(request: PromiseLike<{ error: Error | null; data?: T }>) {
  const { error } = await request;
  if (error) {
    throw error;
  }
}

async function deleteMyUploadedPhotosForAccountDeletion(adminClient: SupabaseAdminClient, userId: string) {
  const { data: submissions, error: submissionsError } = await adminClient
    .from('drop_submissions')
    .select('storage_path, display_storage_path, thumbnail_storage_path')
    .eq('user_id', userId);

  if (submissionsError) {
    console.error('delete-account photo path lookup failed', { userId, error: submissionsError });
    throw submissionsError;
  }

  const storagePaths = ((submissions ?? []) as Submission[])
    .flatMap((submission) => [submission.storage_path, submission.display_storage_path, submission.thumbnail_storage_path])
    .filter((path): path is string => Boolean(path));

  for (let index = 0; index < storagePaths.length; index += 100) {
    const chunk = storagePaths.slice(index, index + 100);
    if (!chunk.length) {
      continue;
    }

    const { error: removeError } = await adminClient.storage.from('daydrop-photos').remove(chunk);
    if (removeError) {
      console.error('delete-account storage cleanup failed', { userId, paths: chunk, error: removeError });
      throw removeError;
    }
  }
}

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
