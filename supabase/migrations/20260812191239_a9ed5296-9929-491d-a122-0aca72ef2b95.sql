UPDATE public.hub_fiscal_emissions 
SET status = 'cancel_rejected' 
WHERE external_id = 'cte-6e874e6e-1786042695890-hd277n';

UPDATE public.fiscal_documents 
SET status = 'cancel_rejected', sefaz_status = 'cancel_rejected'
WHERE invoice_number = 'cte-6e874e6e-1786042695890-hd277n';
-- linter:allow-no-tenant legacy-migration 2026-12-31
