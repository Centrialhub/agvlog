
CREATE TABLE IF NOT EXISTS public.operational_event_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL REFERENCES public.operational_events(id) ON DELETE CASCADE,
  sender_id uuid,
  sender_role text NOT NULL DEFAULT 'operator',
  sender_name text,
  message text NOT NULL,
  attachment_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oem_event ON public.operational_event_messages(event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_oem_tenant ON public.operational_event_messages(tenant_id);

ALTER TABLE public.operational_event_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant members read event messages" ON public.operational_event_messages;
CREATE POLICY "tenant members read event messages"
ON public.operational_event_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.tenant_id = operational_event_messages.tenant_id
      AND tm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "tenant members insert event messages" ON public.operational_event_messages;
CREATE POLICY "tenant members insert event messages"
ON public.operational_event_messages
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.tenant_id = operational_event_messages.tenant_id
      AND tm.user_id = auth.uid()
  )
);

ALTER TABLE public.operational_event_messages REPLICA IDENTITY FULL;
ALTER TABLE public.operational_events REPLICA IDENTITY FULL;

DO $$ BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.operational_event_messages';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.operational_events';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
