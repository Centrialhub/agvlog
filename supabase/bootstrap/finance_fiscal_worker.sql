-- Run as database owner after the financial migrations and pg_cron installation.
-- Same job name is updated in place; this never creates a second consumer.
select cron.schedule('finance-fiscal-projection-every-minute','* * * * *',
 'SET statement_timeout = ''25s''; SELECT finance_private.run_fiscal_queue(50);');
