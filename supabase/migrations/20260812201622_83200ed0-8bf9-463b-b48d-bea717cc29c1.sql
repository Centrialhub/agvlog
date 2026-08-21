ALTER TABLE public.nfse_documents
  ADD COLUMN IF NOT EXISTS cliente_cod_municipio text,
  ADD COLUMN IF NOT EXISTS cliente_numero text,
  ADD COLUMN IF NOT EXISTS cliente_complemento text,
  ADD COLUMN IF NOT EXISTS cliente_im text,
  ADD COLUMN IF NOT EXISTS cliente_telefone text;

-- Backfill do código IBGE / número / complemento a partir do cadastro de clientes
UPDATE public.nfse_documents n
SET cliente_cod_municipio = COALESCE(n.cliente_cod_municipio, c.address_city_ibge_code),
    cliente_numero = COALESCE(n.cliente_numero, c.address_number),
    cliente_complemento = COALESCE(n.cliente_complemento, c.address_complement),
    cliente_im = COALESCE(n.cliente_im, c.municipal_registration),
    cliente_telefone = COALESCE(n.cliente_telefone, c.phone),
    cliente_email = COALESCE(n.cliente_email, c.email)
FROM public.clients c
WHERE c.id = n.cliente_id;

-- Quando o município do tomador foi gravado como código IBGE (7 dígitos)
UPDATE public.nfse_documents
SET cliente_cod_municipio = cliente_municipio
WHERE cliente_cod_municipio IS NULL
  AND cliente_municipio ~ '^[0-9]{7}$';