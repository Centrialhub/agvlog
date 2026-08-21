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
    v.plate as plate,
    l.trip_id,
    l.notes,
    l.created_at,
    l.updated_at
FROM public.loads l
LEFT JOIN public.drivers d ON l.driver_id = d.id
LEFT JOIN public.vehicles v ON l.vehicle_id = v.id;
