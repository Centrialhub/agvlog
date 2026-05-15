
CREATE TABLE IF NOT EXISTS public.driver_direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  sender_id uuid,
  sender_role text NOT NULL DEFAULT 'operator',
  sender_name text,
  message text NOT NULL,
  attachment_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ddm_driver ON public.driver_direct_messages(driver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ddm_tenant ON public.driver_direct_messages(tenant_id);

ALTER TABLE public.driver_direct_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read driver direct messages"
ON public.driver_direct_messages FOR SELECT
TO authenticated
USING (public.is_tenant_member(tenant_id));

CREATE POLICY "tenant members insert driver direct messages"
ON public.driver_direct_messages FOR INSERT
TO authenticated
WITH CHECK (public.is_tenant_member(tenant_id));

ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_direct_messages;
ALTER TABLE public.driver_direct_messages REPLICA IDENTITY FULL;
