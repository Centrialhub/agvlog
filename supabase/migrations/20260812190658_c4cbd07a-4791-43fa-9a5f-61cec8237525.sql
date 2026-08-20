UPDATE public.hub_fiscal_emissions 
SET status = 'authorized', message = 'Revertido para autorizado conforme solicitado'
WHERE id = '85d6e9a5-b0a1-4094-b66e-e041a4e41c5d';

UPDATE public.fiscal_documents
SET status = 'authorized'
WHERE id = '089e538e-412f-43a9-8f57-bad15c554bd4';
-- linter:allow-no-tenant legacy-migration 2026-12-31
