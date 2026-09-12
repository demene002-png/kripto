-- Supabase Cron, Vercel'deki PAPER100 arka plan iscisini her dakika tetikler.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname='paper100-cloud-runner';
select cron.schedule('paper100-cloud-runner','* * * * *',$$select net.http_post(url:='https://kripto1.vercel.app/api/paper-runner',headers:='{"Content-Type":"application/json"}'::jsonb,body:='{}'::jsonb);$$);
