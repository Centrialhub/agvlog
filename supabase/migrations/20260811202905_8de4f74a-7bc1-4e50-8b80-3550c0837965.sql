UPDATE public.loads 
SET status = 'planned', 
    driver_id = NULL, 
    trip_id = NULL 
WHERE load_number = '1042' 
  AND tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4';

UPDATE public.dispatch_trips 
SET status = 'cancelled'
WHERE driver_id = 'b0b8068e-b8bc-4f17-8a74-9701dcd8cc28' 
  AND status NOT IN ('completed', 'cancelled');

UPDATE public.loads 
SET status = 'planned', 
    trip_id = NULL 
WHERE driver_id = 'b0b8068e-b8bc-4f17-8a74-9701dcd8cc28' 
  AND status = 'in_transit';