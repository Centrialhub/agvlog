
-- 1. Função utilitária de normalização (sem depender da extensão unaccent)
CREATE OR REPLACE FUNCTION public.op_route_norm(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(translate(
    coalesce(txt,''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
  ))
$$;

-- 2. Merge: desativa MG-* que colidem com ROTA NN - * na mesma cidade
WITH pares AS (
  SELECT DISTINCT r_mg.id AS old_id
  FROM public.operational_routes r_mg
  JOIN public.operational_routes r_rt
    ON r_rt.tenant_id = r_mg.tenant_id
   AND r_rt.active
   AND r_rt.name LIKE 'ROTA %'
   AND r_mg.name LIKE 'MG-%'
   AND r_mg.active
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements(coalesce(r_mg.destinations,'[]'::jsonb)) d_mg
       JOIN jsonb_array_elements(coalesce(r_rt.destinations,'[]'::jsonb)) d_rt
         ON public.op_route_norm(coalesce(d_mg->>'name', d_mg->>'city', d_mg#>>'{}'))
          = public.op_route_norm(coalesce(d_rt->>'name', d_rt->>'city', d_rt#>>'{}'))
   )
)
UPDATE public.operational_routes
   SET active = false,
       updated_at = now()
 WHERE id IN (SELECT old_id FROM pares);

-- 3. Índice único parcial: proíbe nome duplicado entre rotas ATIVAS do mesmo tenant
CREATE UNIQUE INDEX IF NOT EXISTS operational_routes_tenant_name_key
  ON public.operational_routes (tenant_id, public.op_route_norm(name))
  WHERE active;

-- 4. Trigger que impede "renomear sozinha": se um UPDATE mandar name NULL/'' mantém o antigo
CREATE OR REPLACE FUNCTION public.operational_routes_guard_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS NULL OR btrim(NEW.name) = '' THEN
    NEW.name := OLD.name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operational_routes_guard_name ON public.operational_routes;
CREATE TRIGGER trg_operational_routes_guard_name
  BEFORE UPDATE ON public.operational_routes
  FOR EACH ROW
  EXECUTE FUNCTION public.operational_routes_guard_name();

-- 5. Auditoria de alterações de nome (usa entity_audit_log existente)
CREATE OR REPLACE FUNCTION public.operational_routes_audit_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO public.entity_audit_log (
      tenant_id, entity_type, entity_id, action, changed_by, changes
    ) VALUES (
      NEW.tenant_id, 'operational_route', NEW.id, 'rename', auth.uid(),
      jsonb_build_object('from', OLD.name, 'to', NEW.name)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operational_routes_audit_name ON public.operational_routes;
CREATE TRIGGER trg_operational_routes_audit_name
  AFTER UPDATE OF name ON public.operational_routes
  FOR EACH ROW
  EXECUTE FUNCTION public.operational_routes_audit_name();
