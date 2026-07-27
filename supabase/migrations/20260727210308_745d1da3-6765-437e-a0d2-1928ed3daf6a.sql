
ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS remitter_state_registration text,
  ADD COLUMN IF NOT EXISTS remitter_ie_indicator text;

CREATE OR REPLACE FUNCTION public.trg_fiscal_documents_autolink_supplier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cnpj text;
  v_ie_raw text;
  v_ie text;
  v_supplier_id uuid;
  v_is_isento boolean;
BEGIN
  v_cnpj := regexp_replace(coalesce(NEW.remitter_cnpj,''),'\D','','g');
  v_ie_raw := coalesce(NEW.remitter_state_registration,'');
  v_is_isento := v_ie_raw ~* '^(isento|isenta|is|ex|unknown)$';
  v_ie := CASE WHEN v_is_isento THEN 'ISENTO'
               ELSE nullif(regexp_replace(v_ie_raw, '\D', '', 'g'), '') END;

  -- Try to link to existing supplier by CNPJ
  IF NEW.supplier_id IS NULL AND length(v_cnpj) > 0 THEN
    SELECT id INTO v_supplier_id
      FROM public.clients
     WHERE tenant_id = NEW.tenant_id
       AND regexp_replace(coalesce(tax_id,''),'\D','','g') = v_cnpj
     ORDER BY is_supplier DESC, active DESC, created_at ASC
     LIMIT 1;
    NEW.supplier_id := v_supplier_id;
  END IF;

  -- If still unlinked but we have CNPJ + a remitter name, create a minimal supplier
  IF NEW.supplier_id IS NULL AND length(v_cnpj) > 0 AND coalesce(NEW.remitter, '') <> '' THEN
    INSERT INTO public.clients (
      tenant_id, company_name, legal_name, tax_id,
      person_type, client_type,
      is_client, is_supplier,
      state_registration, active, blocked
    ) VALUES (
      NEW.tenant_id,
      NEW.remitter,
      NEW.remitter,
      CASE WHEN length(v_cnpj) = 14
           THEN substr(v_cnpj,1,2)||'.'||substr(v_cnpj,3,3)||'.'||substr(v_cnpj,6,3)||'/'||substr(v_cnpj,9,4)||'-'||substr(v_cnpj,13,2)
           ELSE v_cnpj END,
      CASE WHEN length(v_cnpj) = 11 THEN 'CPF' ELSE 'CNPJ' END,
      CASE WHEN length(v_cnpj) = 11 THEN 'PF' ELSE 'PJ' END,
      false, true,
      v_ie, true, false
    )
    RETURNING id INTO v_supplier_id;
    NEW.supplier_id := v_supplier_id;
  END IF;

  -- Backfill IE / address hints on the supplier if empty
  IF NEW.supplier_id IS NOT NULL AND v_ie IS NOT NULL THEN
    UPDATE public.clients
       SET state_registration = v_ie,
           is_supplier = true
     WHERE id = NEW.supplier_id
       AND (state_registration IS NULL OR btrim(state_registration) = '');
  END IF;

  RETURN NEW;
END;
$function$;

-- Backfill: pull IE from any prior fiscal_document rows that already carry it
UPDATE public.clients c
   SET state_registration = sub.ie
  FROM (
    SELECT DISTINCT ON (regexp_replace(coalesce(remitter_cnpj,''),'\D','','g'))
           regexp_replace(coalesce(remitter_cnpj,''),'\D','','g') AS cnpj,
           nullif(regexp_replace(coalesce(remitter_state_registration,''), '\D', '', 'g'), '') AS ie,
           tenant_id
      FROM public.fiscal_documents
     WHERE coalesce(remitter_state_registration,'') <> ''
     ORDER BY regexp_replace(coalesce(remitter_cnpj,''),'\D','','g'),
              issue_date DESC NULLS LAST
  ) sub
 WHERE regexp_replace(coalesce(c.tax_id,''),'\D','','g') = sub.cnpj
   AND c.tenant_id = sub.tenant_id
   AND (c.state_registration IS NULL OR btrim(c.state_registration) = '')
   AND sub.ie IS NOT NULL;
