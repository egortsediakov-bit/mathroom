-- Run after deploying the drive-backup Edge Function.
-- Replace the placeholder values before running.
-- Time in pg_cron is UTC. 00:15 UTC = 03:15 Moscow time.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

select vault.create_secret('https://YOUR_PROJECT.supabase.co', 'mathroom_project_url');
select vault.create_secret('YOUR_PUBLISHABLE_KEY', 'mathroom_publishable_key');
select vault.create_secret('MAKE_A_LONG_RANDOM_SECRET', 'mathroom_backup_cron_secret');

select cron.schedule(
  'mathroom-daily-drive-backup',
  '15 0 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='mathroom_project_url') || '/functions/v1/drive-backup',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='mathroom_publishable_key'),
      'x-backup-secret',(select decrypted_secret from vault.decrypted_secrets where name='mathroom_backup_cron_secret')
    ),
    body := jsonb_build_object('source','cron','created_at',now())
  );
  $$
);
