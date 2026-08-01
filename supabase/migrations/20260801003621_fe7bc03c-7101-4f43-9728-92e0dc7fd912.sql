UPDATE public.clients
SET state_registration = NULL,
    tax_code = CASE WHEN upper(coalesce(tax_code,'')) = 'UNKNOWN' THEN NULL ELSE tax_code END,
    tax_description = CASE WHEN upper(coalesce(tax_description,'')) = 'UNKNOWN' THEN NULL ELSE tax_description END,
    updated_at = now()
WHERE upper(coalesce(state_registration,'')) IN ('UNKNOWN','DESCONHECIDO','ILEGIVEL','ILEGÍVEL','N/I','NI','N/A','NA');