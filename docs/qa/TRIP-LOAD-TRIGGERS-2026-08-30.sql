-- Read-only production trigger capture 2026-08-30. QA fixture, not a deployment.

CREATE OR REPLACE FUNCTION public._tg_mark_outdated_trip_loads()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_trip uuid; v_tid uuid;
BEGIN
  v_trip := COALESCE(NEW.dispatch_trip_id, OLD.dispatch_trip_id);
  SELECT tenant_id INTO v_tid FROM public.dispatch_trips WHERE id = v_trip;
  IF v_tid IS NOT NULL THEN PERFORM public.mark_driver_settlement_outdated(v_tid, v_trip, 'trip_loads_change'); END IF;
  RETURN COALESCE(NEW, OLD);
END; $function$;

CREATE OR REPLACE FUNCTION public.check_load_dispatch_duplicity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM public.dispatch_trip_loads dtl
    JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
    WHERE dtl.load_id = NEW.load_id
      AND dt.status NOT IN ('cancelled', 'completed')
      AND dtl.dispatch_trip_id <> NEW.dispatch_trip_id
  ) THEN
    RAISE EXCEPTION 'Carga % já está vinculada a uma viagem ativa', NEW.load_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_trip_load_mirrors()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Atualiza espelho na loads (apenas se for o primeiro link ou principal)
        UPDATE public.loads 
        SET trip_id = NEW.dispatch_trip_id, 
            updated_at = now() 
        WHERE id = NEW.load_id AND (trip_id IS NULL OR trip_id = NEW.dispatch_trip_id);
        
        -- Atualiza espelho na dispatch_trips (apenas se for o primeiro link ou principal)
        UPDATE public.dispatch_trips 
        SET load_id = NEW.load_id, 
            updated_at = now() 
        WHERE id = NEW.dispatch_trip_id AND (load_id IS NULL OR load_id = NEW.load_id);
    ELSIF TG_OP = 'DELETE' THEN
        -- Limpa espelhos se a relação for removida
        UPDATE public.loads 
        SET trip_id = NULL, 
            updated_at = now() 
        WHERE id = OLD.load_id AND trip_id = OLD.dispatch_trip_id;
        
        UPDATE public.dispatch_trips 
        SET load_id = NULL, 
            updated_at = now() 
        WHERE id = OLD.dispatch_trip_id AND load_id = OLD.load_id;
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_driver_settlement_outdated(_tenant_id uuid, _dispatch_trip_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_s public.driver_settlements;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements
    WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_s.status IN ('pending_review','in_review','reopened') THEN
    UPDATE public.driver_settlements SET
      needs_recalculation = true,
      recalculation_reason = _reason,
      source_updated_at = now()
    WHERE id = v_s.id;
  END IF;
  PERFORM public._log_settlement_event(v_s.id, 'marked_outdated', v_s.status, v_s.status, _reason, '{}'::jsonb);
END; $function$;
