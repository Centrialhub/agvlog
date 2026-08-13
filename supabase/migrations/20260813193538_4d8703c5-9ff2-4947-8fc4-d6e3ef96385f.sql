-- Add audit columns for soft delete
ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id);

-- Function for secure logical deletion
CREATE OR REPLACE FUNCTION public.soft_delete_fiscal_document(doc_id UUID, user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.fiscal_documents
  SET 
    deleted_at = now(),
    deleted_by = user_id,
    load_id = NULL,
    status = 'deleted'
  WHERE id = doc_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.soft_delete_fiscal_document TO authenticated;