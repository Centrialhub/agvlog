ALTER TABLE public.operational_routes
ADD COLUMN IF NOT EXISTS periodicity_default text;

COMMENT ON COLUMN public.operational_routes.periodicity_default IS 'Frequência padrão da rota: daily | weekly | biweekly | monthly';
COMMENT ON COLUMN public.operational_routes.destinations IS 'Array JSONB de cidades. Cada item: { name: string, periodicity?: daily|weekly|biweekly|monthly, weekdays?: number[] (0=Dom..6=Sáb) }';