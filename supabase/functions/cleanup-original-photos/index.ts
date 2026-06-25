// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

const DROP_PHOTOS_BUCKET = 'daydrop-photos';
const INTERNAL_SECRET_HEADER = 'x-internal-cleanup-secret';
const DEFAULT_RETENTION_HOURS = 7 * 24;
const MAX_RETENTION_HOURS = 10 * 365 * 24;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const SAMPLE_LIMIT = 25;
const DELETE_CONFIRMATION = 'DELETE_ORIGINAL_PHOTOS';

type CleanupRequest = {
  confirm?: string;
  dryRun?: boolean;
  limit?: number;
  retentionDays?: number;
  retentionHours?: number;
};

type DailyDropReference = {
  drop_date: string | null;
};

type SubmissionRow = {
  couple_id: string | null;
  daily_drop: DailyDropReference | DailyDropReference[] | null;
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

type SkipReason =
  | 'missing_display_path'
  | 'missing_display_object'
  | 'missing_thumbnail_path'
  | 'missing_thumbnail_object'
  | 'missing_original_object'
  | 'too_recent'
  | 'today_drop'
  | 'already_deleted'
  | 'unknown_error';

type CleanupCandidate = {
  age_days: number;
  age_hours: number;
  created_at: string;
  display_storage_path: string;
  id: string;
  original_file_size_bytes: number;
  reason: string;
  retention_hours: number;
  storage_path: string;
  submission_id: string;
  submitted_at: string;
  thumbnail_storage_path: string;
  user_id: string | null;
};

type SkippedSubmission = {
  age_days: number | null;
  age_hours: number | null;
  created_at: string | null;
  display_storage_path: string | null;
  error?: string;
  id: string;
  reason: SkipReason;
  storage_path: string | null;
  submission_id: string;
  submitted_at: string | null;
  thumbnail_storage_path: string | null;
};

type StorageObjectInfo = {
  exists: boolean;
  size: number | null;
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
  const retentionHours = normalizeRetentionHours(body);
  const now = new Date();
  const cutoff = new Date(now.getTime() - retentionHours * HOUR_MS).toISOString();
  const todayDropDate = now.toISOString().slice(0, 10);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const submissions = await fetchSubmissionsForAnalysis(adminClient, limit);
    const analysis = await analyzeSubmissions(adminClient, submissions, {
      cutoff,
      now,
      retentionHours,
      todayDropDate,
    });

    if (dryRun) {
      return json(createDryRunResponse(analysis, { cutoff, limit, retentionHours }), 200);
    }

    if (body?.confirm !== DELETE_CONFIRMATION) {
      return json(
        {
          error: 'delete_confirmation_required',
          ok: false,
          dryRun: false,
          requiredConfirmation: DELETE_CONFIRMATION,
        },
        409
      );
    }

    if (Deno.env.get('ENABLE_ORIGINAL_PHOTO_DELETE') !== 'true') {
      return json(
        {
          error: 'original_photo_delete_disabled',
          ok: false,
          dryRun: false,
        },
        409
      );
    }

    const deleted: Array<CleanupCandidate & { deleted_at: string }> = [];
    const failed: Array<CleanupCandidate & { error: string }> = [];

    for (const candidate of analysis.candidates) {
      try {
        const { error: removeError } = await adminClient.storage.from(DROP_PHOTOS_BUCKET).remove([candidate.storage_path]);
        if (removeError) {
          throw removeError;
        }

        const deletedAt = new Date().toISOString();
        const { error: updateError } = await adminClient
          .from('drop_submissions')
          .update({
            original_deleted_at: deletedAt,
            original_deleted_reason: candidate.reason,
          })
          .eq('id', candidate.submission_id)
          .is('original_deleted_at', null);

        if (updateError) {
          throw updateError;
        }

        deleted.push({
          ...candidate,
          deleted_at: deletedAt,
        });
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('[cleanup-original-photos] original delete failed', {
          error,
          storagePath: candidate.storage_path,
          submissionId: candidate.submission_id,
        });
        failed.push({
          ...candidate,
          error: message,
        });
      }
    }

    return json(
      {
        ok: true,
        dryRun: false,
        cutoff,
        retentionHours,
        retentionDays: retentionHours / 24,
        scannedCount: submissions.length,
        eligibleCount: analysis.candidates.length,
        skippedCount: analysis.skipped.length,
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

async function fetchSubmissionsForAnalysis(adminClient: ReturnType<typeof createClient>, limit: number) {
  const { data, error } = await adminClient
    .from('drop_submissions')
    .select(
      'id,user_id,couple_id,drop_id,submitted_at,storage_path,image_url,display_image_url,display_storage_path,thumbnail_image_url,thumbnail_storage_path,original_deleted_at,daily_drop:daily_drops(drop_date)'
    )
    .order('original_deleted_at', { ascending: true, nullsFirst: true })
    .order('submitted_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as SubmissionRow[];
}

async function analyzeSubmissions(
  adminClient: ReturnType<typeof createClient>,
  submissions: SubmissionRow[],
  {
    cutoff,
    now,
    retentionHours,
    todayDropDate,
  }: {
    cutoff: string;
    now: Date;
    retentionHours: number;
    todayDropDate: string;
  }
) {
  const candidates: CleanupCandidate[] = [];
  const skipped: SkippedSubmission[] = [];
  const cutoffTime = new Date(cutoff).getTime();

  for (const submission of submissions) {
    const submittedAt = submission.submitted_at?.trim() || null;
    const submittedTime = submittedAt ? new Date(submittedAt).getTime() : Number.NaN;
    const ageHours = Number.isFinite(submittedTime) ? Math.max(0, (now.getTime() - submittedTime) / HOUR_MS) : null;
    const baseSkipped = createSkippedSubmission(submission, ageHours);
    const displayStoragePath = submission.display_storage_path?.trim() || null;
    const storagePath = submission.storage_path?.trim() || null;
    const thumbnailStoragePath = submission.thumbnail_storage_path?.trim() || null;

    if (submission.original_deleted_at) {
      skipped.push({ ...baseSkipped, reason: 'already_deleted' });
      continue;
    }

    if (getDropDate(submission.daily_drop) === todayDropDate) {
      skipped.push({ ...baseSkipped, reason: 'today_drop' });
      continue;
    }

    if (!submittedAt || !Number.isFinite(submittedTime)) {
      skipped.push({ ...baseSkipped, reason: 'unknown_error', error: 'invalid_submitted_at' });
      continue;
    }

    if (submittedTime >= cutoffTime) {
      skipped.push({ ...baseSkipped, reason: 'too_recent' });
      continue;
    }

    if (!storagePath) {
      skipped.push({ ...baseSkipped, reason: 'missing_original_object' });
      continue;
    }

    if (!displayStoragePath) {
      skipped.push({ ...baseSkipped, reason: 'missing_display_path' });
      continue;
    }

    if (!thumbnailStoragePath) {
      skipped.push({ ...baseSkipped, reason: 'missing_thumbnail_path' });
      continue;
    }

    try {
      const [originalObject, displayObject, thumbnailObject] = await Promise.all([
        getStorageObjectInfo(adminClient, storagePath),
        getStorageObjectInfo(adminClient, displayStoragePath),
        getStorageObjectInfo(adminClient, thumbnailStoragePath),
      ]);

      if (!originalObject.exists) {
        skipped.push({ ...baseSkipped, reason: 'missing_original_object' });
        continue;
      }

      if (!displayObject.exists) {
        skipped.push({ ...baseSkipped, reason: 'missing_display_object' });
        continue;
      }

      if (!thumbnailObject.exists) {
        skipped.push({ ...baseSkipped, reason: 'missing_thumbnail_object' });
        continue;
      }

      if (originalObject.size === null) {
        skipped.push({ ...baseSkipped, reason: 'unknown_error', error: 'original_size_unavailable' });
        continue;
      }

      candidates.push({
        age_days: round(ageHours! / 24, 2),
        age_hours: round(ageHours!, 2),
        created_at: submittedAt,
        display_storage_path: displayStoragePath,
        id: submission.id,
        original_file_size_bytes: originalObject.size,
        reason: `original_retention_${retentionHours}_hours_display_thumbnail_exist`,
        retention_hours: retentionHours,
        storage_path: storagePath,
        submission_id: submission.id,
        submitted_at: submittedAt,
        thumbnail_storage_path: thumbnailStoragePath,
        user_id: submission.user_id,
      });
    } catch (error) {
      console.error('[cleanup-original-photos] storage analysis failed', {
        error,
        submissionId: submission.id,
      });
      skipped.push({
        ...baseSkipped,
        error: getErrorMessage(error),
        reason: 'unknown_error',
      });
    }
  }

  return {
    candidates,
    skipped,
  };
}

function createDryRunResponse(
  analysis: Awaited<ReturnType<typeof analyzeSubmissions>>,
  {
    cutoff,
    limit,
    retentionHours,
  }: {
    cutoff: string;
    limit: number;
    retentionHours: number;
  }
) {
  const totalEstimatedBytesToDelete = analysis.candidates.reduce(
    (total, candidate) => total + candidate.original_file_size_bytes,
    0
  );

  return {
    ok: true,
    dryRun: true,
    cutoff,
    limit,
    retentionHours,
    retentionDays: retentionHours / 24,
    scannedCount: analysis.candidates.length + analysis.skipped.length,
    eligibleCount: analysis.candidates.length,
    skippedCount: analysis.skipped.length,
    totalEstimatedBytesToDelete,
    totalEstimatedMBToDelete: round(totalEstimatedBytesToDelete / (1024 * 1024), 2),
    candidates: analysis.candidates.slice(0, SAMPLE_LIMIT),
    skipped: analysis.skipped.slice(0, SAMPLE_LIMIT),
    skipReasons: countSkipReasons(analysis.skipped),
    sampleLimit: SAMPLE_LIMIT,
  };
}

function createSkippedSubmission(submission: SubmissionRow, ageHours: number | null): Omit<SkippedSubmission, 'reason'> {
  return {
    age_days: ageHours === null ? null : round(ageHours / 24, 2),
    age_hours: ageHours === null ? null : round(ageHours, 2),
    created_at: submission.submitted_at ?? null,
    display_storage_path: submission.display_storage_path?.trim() || null,
    id: submission.id,
    storage_path: submission.storage_path?.trim() || null,
    submission_id: submission.id,
    submitted_at: submission.submitted_at ?? null,
    thumbnail_storage_path: submission.thumbnail_storage_path?.trim() || null,
  };
}

function countSkipReasons(skipped: SkippedSubmission[]) {
  const counts: Record<SkipReason, number> = {
    missing_display_path: 0,
    missing_display_object: 0,
    missing_thumbnail_path: 0,
    missing_thumbnail_object: 0,
    missing_original_object: 0,
    too_recent: 0,
    today_drop: 0,
    already_deleted: 0,
    unknown_error: 0,
  };

  skipped.forEach((submission) => {
    counts[submission.reason] += 1;
  });

  return counts;
}

async function getStorageObjectInfo(
  adminClient: ReturnType<typeof createClient>,
  storagePath: string
): Promise<StorageObjectInfo> {
  const lastSlashIndex = storagePath.lastIndexOf('/');
  const folderPath = lastSlashIndex === -1 ? '' : storagePath.slice(0, lastSlashIndex);
  const fileName = lastSlashIndex === -1 ? storagePath : storagePath.slice(lastSlashIndex + 1);

  const { data, error } = await adminClient.storage.from(DROP_PHOTOS_BUCKET).list(folderPath, {
    limit: 100,
    search: fileName,
  });

  if (error) {
    throw error;
  }

  const object = data?.find((item) => item.name === fileName);
  if (!object) {
    return { exists: false, size: null };
  }

  const metadata = object.metadata as { contentLength?: unknown; size?: unknown } | null;
  const rawSize = metadata?.size ?? metadata?.contentLength;
  const numericSize = typeof rawSize === 'number' || typeof rawSize === 'string' ? Number(rawSize) : Number.NaN;
  const size = Number.isFinite(numericSize) && numericSize >= 0 ? numericSize : null;

  return {
    exists: true,
    size,
  };
}

function getDropDate(reference: SubmissionRow['daily_drop']) {
  if (Array.isArray(reference)) {
    return reference[0]?.drop_date ?? null;
  }

  return reference?.drop_date ?? null;
}

function normalizeRetentionHours(body: CleanupRequest | null) {
  if (isPositiveFiniteNumber(body?.retentionHours)) {
    return Math.min(MAX_RETENTION_HOURS, body.retentionHours);
  }

  if (isPositiveFiniteNumber(body?.retentionDays)) {
    return Math.min(MAX_RETENTION_HOURS, body.retentionDays * 24);
  }

  return DEFAULT_RETENTION_HOURS;
}

function normalizeLimit(limit: unknown) {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function round(value: number, decimalPlaces: number) {
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
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
