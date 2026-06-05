// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

const DROP_PHOTOS_BUCKET = 'daydrop-photos';
const INTERNAL_SECRET_HEADER = 'x-internal-cleanup-secret';
const ORIGINAL_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_SCAN_LIMIT = 1500;

type CleanupRequest = {
  dryRun?: boolean;
  limit?: number;
};

type SubmissionRow = {
  couple_id: string | null;
  display_image_url: string | null;
  display_storage_path: string | null;
  drop_id: string | null;
  id: string;
  image_url: string | null;
  original_deleted_at: string | null;
  storage_path: string | null;
  submitted_at: string | null;
  thumbnail_image_url: string | null;
  thumbnail_storage_path: string | null;
  user_id: string | null;
};

type CleanupTarget = {
  created_at: string | null;
  display_image_exists: boolean;
  display_image_url: string | null;
  display_storage_path: string | null;
  id: string;
  original_deleted_at: string | null;
  original_deleted_at_exists: boolean;
  reason: string;
  retention_days: number;
  storage_path: string;
  submission_id: string;
  thumbnail_image_exists: boolean;
  thumbnail_image_url: string | null;
  thumbnail_storage_path: string | null;
  user_id: string | null;
};

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-cleanup-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
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
  const cleanupSecret = Deno.env.get('CLEANUP_ORIGINAL_PHOTOS_SECRET');

  if (!supabaseUrl || !serviceRoleKey || !cleanupSecret) {
    return json({ error: 'missing_server_config' }, 500);
  }

  if (req.headers.get(INTERNAL_SECRET_HEADER) !== cleanupSecret) {
    return json({ error: 'unauthorized' }, 401);
  }

  const body = await safeJson(req);
  const dryRun = body?.dryRun !== false;
  const limit = normalizeLimit(body?.limit);
  const now = new Date();
  const cutoff = new Date(now.getTime() - getOriginalRetentionDays() * DAY_MS).toISOString();

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const candidates = await fetchCandidateSubmissions(adminClient, {
      cutoff,
      scanLimit: MAX_SCAN_LIMIT,
    });
    const targets = await collectCleanupTargets(adminClient, candidates, limit);

    if (dryRun) {
      return json(
        {
          ok: true,
          dryRun: true,
          cutoff,
          retentionDays: getOriginalRetentionDays(),
          scannedCount: candidates.length,
          targetCount: targets.length,
          targets,
        },
        200
      );
    }

    const deleted: Array<CleanupTarget & { deleted_at: string }> = [];
    const failed: Array<CleanupTarget & { error: string }> = [];

    for (const target of targets) {
      try {
        const { error: removeError } = await adminClient.storage.from(DROP_PHOTOS_BUCKET).remove([target.storage_path]);
        if (removeError) {
          throw removeError;
        }

        const deletedAt = new Date().toISOString();
        const { error: updateError } = await adminClient
          .from('drop_submissions')
          .update({
            original_deleted_at: deletedAt,
            original_deleted_reason: target.reason,
          })
          .eq('id', target.submission_id)
          .is('original_deleted_at', null);

        if (updateError) {
          throw updateError;
        }

        deleted.push({
          ...target,
          deleted_at: deletedAt,
        });
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('[cleanup-original-photos] original delete failed', {
          error,
          storagePath: target.storage_path,
          submissionId: target.submission_id,
        });
        failed.push({
          ...target,
          error: message,
        });
      }
    }

    return json(
      {
        ok: true,
        dryRun: false,
        cutoff,
        retentionDays: getOriginalRetentionDays(),
        scannedCount: candidates.length,
        targetCount: targets.length,
        deletedCount: deleted.length,
        failedCount: failed.length,
        deleted,
        failed,
      },
      200
    );
  } catch (error) {
    console.error('[cleanup-original-photos] failed', error);
    return json({ error: 'cleanup_original_photos_failed' }, 500);
  }
});

function getOriginalRetentionDays() {
  return ORIGINAL_RETENTION_DAYS;
}

async function fetchCandidateSubmissions(
  adminClient: ReturnType<typeof createClient>,
  {
    cutoff,
    scanLimit,
  }: {
    cutoff: string;
    scanLimit: number;
  }
) {
  const { data, error } = await adminClient
    .from('drop_submissions')
    .select(
      'id,user_id,couple_id,drop_id,submitted_at,storage_path,image_url,display_image_url,display_storage_path,thumbnail_image_url,thumbnail_storage_path,original_deleted_at'
    )
    .is('original_deleted_at', null)
    .not('storage_path', 'is', null)
    .not('display_storage_path', 'is', null)
    .lt('submitted_at', cutoff)
    .order('submitted_at', { ascending: true })
    .limit(scanLimit);

  if (error) {
    throw error;
  }

  return ((data ?? []) as SubmissionRow[])
    .filter(isCompleteCandidate)
    .sort((left, right) => {
      const thumbnailPriority = Number(Boolean(right.thumbnail_storage_path?.trim())) - Number(Boolean(left.thumbnail_storage_path?.trim()));
      if (thumbnailPriority !== 0) {
        return thumbnailPriority;
      }

      return new Date(left.submitted_at ?? 0).getTime() - new Date(right.submitted_at ?? 0).getTime();
    });
}

function isCompleteCandidate(row: SubmissionRow) {
  return Boolean(
    row.id &&
      row.user_id &&
      row.couple_id &&
      row.drop_id &&
      row.submitted_at &&
      row.storage_path?.trim() &&
      row.display_storage_path?.trim() &&
      !row.original_deleted_at
  );
}

async function collectCleanupTargets(adminClient: ReturnType<typeof createClient>, candidates: SubmissionRow[], limit: number) {
  const targets: CleanupTarget[] = [];

  for (const candidate of candidates) {
    if (targets.length >= limit) {
      break;
    }

    const displayStoragePath = candidate.display_storage_path?.trim() ?? '';
    const storagePath = candidate.storage_path?.trim() ?? '';
    const thumbnailStoragePath = candidate.thumbnail_storage_path?.trim() || null;
    let displayImageExists = false;
    let thumbnailImageExists = false;

    try {
      displayImageExists = await storageObjectExists(adminClient, displayStoragePath);

      if (!displayImageExists) {
        console.warn('[cleanup-original-photos] skipped original cleanup because display image is missing', {
          displayStoragePath,
          storagePath,
          submissionId: candidate.id,
        });
        continue;
      }

      thumbnailImageExists = thumbnailStoragePath ? await storageObjectExists(adminClient, thumbnailStoragePath) : false;
    } catch (error) {
      console.error('[cleanup-original-photos] skipped original cleanup after optimized image lookup failed', {
        displayStoragePath,
        error,
        storagePath,
        submissionId: candidate.id,
        thumbnailStoragePath,
      });
      continue;
    }

    targets.push({
      created_at: candidate.submitted_at,
      display_image_exists: displayImageExists,
      display_image_url: candidate.display_image_url ?? null,
      display_storage_path: displayStoragePath,
      id: candidate.id,
      original_deleted_at: candidate.original_deleted_at ?? null,
      original_deleted_at_exists: Boolean(candidate.original_deleted_at),
      reason: `original_retention_${getOriginalRetentionDays()}_days_display_exists`,
      retention_days: getOriginalRetentionDays(),
      storage_path: storagePath,
      submission_id: candidate.id,
      thumbnail_image_exists: thumbnailImageExists,
      thumbnail_image_url: candidate.thumbnail_image_url ?? null,
      thumbnail_storage_path: thumbnailStoragePath,
      user_id: candidate.user_id,
    });
  }

  return targets;
}

async function storageObjectExists(adminClient: ReturnType<typeof createClient>, storagePath: string | null | undefined) {
  const normalizedPath = storagePath?.trim();
  if (!normalizedPath) {
    return false;
  }

  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  const folderPath = lastSlashIndex === -1 ? '' : normalizedPath.slice(0, lastSlashIndex);
  const fileName = lastSlashIndex === -1 ? normalizedPath : normalizedPath.slice(lastSlashIndex + 1);

  const { data, error } = await adminClient.storage.from(DROP_PHOTOS_BUCKET).list(folderPath, {
    limit: 100,
    search: fileName,
  });

  if (error) {
    throw error;
  }

  return Boolean(data?.some((item) => item.name === fileName));
}

function normalizeLimit(limit: unknown) {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

async function safeJson(req: Request): Promise<CleanupRequest | null> {
  try {
    return (await req.json()) as CleanupRequest;
  } catch {
    return null;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'unknown_error';
}

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
    status,
  });
}
