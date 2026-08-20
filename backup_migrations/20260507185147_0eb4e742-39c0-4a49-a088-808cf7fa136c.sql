ALTER TABLE public.freight_tables ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_freight_tables_client_id ON public.freight_tables(client_id);
CREATE INDEX IF NOT EXISTS idx_freight_tables_payer_group ON public.freight_tables(payer_group);
CREATE INDEX IF NOT EXISTS idx_freight_tables_dest_region ON public.freight_tables(destination_region);