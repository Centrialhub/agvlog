grant execute on function public.portal_user_can_access_fiscal_document(uuid, uuid) to authenticated;

comment on function public.portal_user_can_access_fiscal_document(uuid, uuid)
  is 'Security-definer scope check used by portal RPCs and fiscal_documents RLS; executable by authenticated callers.';
