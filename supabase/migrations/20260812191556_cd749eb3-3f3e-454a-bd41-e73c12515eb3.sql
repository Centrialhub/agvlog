ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS cost_center text;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS cost_center text;
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS cost_center text;
ALTER TABLE public.payables_payments ADD COLUMN IF NOT EXISTS cost_center text;
ALTER TABLE public.receivables_payments ADD COLUMN IF NOT EXISTS cost_center text;

-- Recreate RPC for manual transactions to include cost_center if needed
-- Or just let the generic supabase client handle it.
