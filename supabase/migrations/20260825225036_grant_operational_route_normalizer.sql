-- The active-route unique index evaluates this normalizer on authenticated
-- inserts and updates. It contains no data access and is safe to expose.
GRANT EXECUTE ON FUNCTION public.op_route_norm(text) TO authenticated;
