-- Run this manually in Supabase SQL Editor after deploying Edge Functions.
-- Purpose: runs every hour; sends to users whose device timezone is currently local 12:00.
-- Docs reference: https://supabase.com/docs/guides/functions/schedule-functions

-- 1) Store secrets in Vault (replace placeholders before running).
select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
select vault.create_secret('<INTERNAL_PUSH_FUNCTION_SECRET>', 'internal_push_function_secret');

-- 2) Schedule job to run hourly.
select
  cron.schedule(
    'send-daily-question-push-hourly-local-noon',
    '0 * * * *',
    $$
    select
      net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-daily-question-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-internal-push-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_push_function_secret')
        ),
        body := jsonb_build_object()
      ) as request_id;
    $$
  );

-- 3) Optional cleanup command.
-- select cron.unschedule('send-daily-question-push-hourly-local-noon');
