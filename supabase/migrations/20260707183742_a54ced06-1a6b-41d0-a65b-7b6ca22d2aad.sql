
CREATE OR REPLACE FUNCTION public._tg_sync_obligations_from_payable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from date; v_to date; v_row public.payables;
BEGIN
  v_row := COALESCE(NEW, OLD);
  v_from := COALESCE(v_row.due_date, v_row.competence_date, (now() - INTERVAL '60 days')::date) - INTERVAL '1 day';
  v_to   := COALESCE(v_row.due_date, v_row.competence_date, now()::date) + INTERVAL '30 days';
  PERFORM public.sync_financial_obligations(v_row.tenant_id, v_from::date, v_to::date);
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._tg_sync_obligations_from_payable() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_obligations_from_payable ON public.payables;
CREATE TRIGGER trg_sync_obligations_from_payable
  AFTER INSERT OR UPDATE OF status, amount, due_date, competence_date, supplier_name
  ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public._tg_sync_obligations_from_payable();
