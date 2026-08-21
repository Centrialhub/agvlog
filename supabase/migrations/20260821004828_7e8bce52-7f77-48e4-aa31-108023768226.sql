DROP VIEW IF EXISTS public.vw_load_control;

CREATE OR REPLACE VIEW public.vw_load_control 
WITH (security_invoker=true)
AS
SELECT 
    l.id,
    l.tenant_id,
    l.load_number,
    l.external_load_number,
    l.load_date,
    l.arrival_date,
    l.status,
    l.operational_status,
    l.billing_status,
    l.payment_status,
    l.freight_amount,
    l.received_amount,
    l.freight_percent,
    l.total_weight_kg,
    l.total_volume_m3,
    l.total_pallet_count,
    l.invoice_count,
    l.cte_count,
    l.expected_payment_date,
    l.payment_date,
    l.gross_cargo_value,
    l.client_invoice_id,
    l.receivable_id,
    l.legacy_status_text,
    d.name as driver_name,
    v.plate as vehicle_plate,
    l.trip_id,
    l.notes,
    l.created_at,
    l.updated_at
FROM public.loads l
LEFT JOIN public.drivers d ON l.driver_id = d.id
LEFT JOIN public.vehicles v ON l.vehicle_id = v.id;

CREATE OR REPLACE FUNCTION public.commit_load_import_v1(
    p_tenant_id uuid,
    p_file_name text,
    p_source_type text, -- 'spreadsheet' or 'xml'
    p_rows jsonb -- Normalized summary/detail rows
)
RETURNS jsonb AS $$
DECLARE
    v_batch_id uuid;
    v_row jsonb;
    v_load_id uuid;
    v_imported_count integer := 0;
    v_duplicated_count integer := 0;
    v_error_count integer := 0;
    v_errors text[] := ARRAY[]::text[];
BEGIN
    INSERT INTO public.load_import_batches (tenant_id, file_name, source_type, status)
    VALUES (p_tenant_id, p_file_name, p_source_type, 'processing')
    RETURNING id INTO v_batch_id;

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
    LOOP
        BEGIN
            -- Logic to match/upsert load
            SELECT id INTO v_load_id 
            FROM public.loads 
            WHERE tenant_id = p_tenant_id 
            AND (external_load_number = v_row->>'external_load_number');

            IF v_load_id IS NULL THEN
                INSERT INTO public.loads (
                    tenant_id, 
                    load_number, 
                    external_load_number, 
                    load_date, 
                    arrival_date,
                    gross_cargo_value, 
                    freight_amount, 
                    payment_status,
                    legacy_status_text,
                    expected_payment_date,
                    last_import_batch_id,
                    status
                ) VALUES (
                    p_tenant_id, 
                    COALESCE(v_row->>'load_number', (SELECT COALESCE(MAX(load_number::int), 1000) + 1 FROM public.loads WHERE tenant_id = p_tenant_id)::text),
                    v_row->>'external_load_number',
                    (v_row->>'load_date')::date,
                    (v_row->>'arrival_date')::date,
                    (v_row->>'gross_cargo_value')::numeric,
                    (v_row->>'freight_amount')::numeric,
                    'unpaid',
                    v_row->>'legacy_status_text',
                    (v_row->>'expected_payment_date')::date,
                    v_batch_id,
                    'assembling'
                ) RETURNING id INTO v_load_id;
                v_imported_count := v_imported_count + 1;
            ELSE
                UPDATE public.loads SET
                    load_date = COALESCE((v_row->>'load_date')::date, load_date),
                    arrival_date = COALESCE((v_row->>'arrival_date')::date, arrival_date),
                    gross_cargo_value = COALESCE((v_row->>'gross_cargo_value')::numeric, gross_cargo_value),
                    freight_amount = COALESCE((v_row->>'freight_amount')::numeric, freight_amount),
                    legacy_status_text = COALESCE(v_row->>'legacy_status_text', legacy_status_text),
                    expected_payment_date = COALESCE((v_row->>'expected_payment_date')::date, expected_payment_date),
                    last_import_batch_id = v_batch_id
                WHERE id = v_load_id;
                v_duplicated_count := v_duplicated_count + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
            v_errors := array_append(v_errors, SQLERRM);
        END;
    END LOOP;

    UPDATE public.load_import_batches SET
        status = 'completed',
        imported_count = v_imported_count,
        duplicated_count = v_duplicated_count,
        error_count = v_error_count
    WHERE id = v_batch_id;

    RETURN jsonb_build_object(
        'batch_id', v_batch_id,
        'newLoads', v_imported_count,
        'updatedLoads', v_duplicated_count,
        'errors', v_errors
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.commit_load_import_v1(uuid, text, text, jsonb) TO authenticated;
