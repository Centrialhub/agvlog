select cron.schedule('finance-bank-reconciliation-every-minute','* * * * *',
 'SET statement_timeout = ''25s''; SELECT finance_private.run_automatic_reconciliation_queue();');
