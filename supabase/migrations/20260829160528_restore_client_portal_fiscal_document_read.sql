alter policy agvlog_select_authenticated
on public.fiscal_documents
using (
  id in (select private._driver_fiscal_document_ids())
  or public.is_tenant_admin(tenant_id)
  or public.is_user_internal_role(tenant_id)
  or public.portal_user_can_access_fiscal_document(tenant_id, id)
);

comment on policy agvlog_select_authenticated on public.fiscal_documents
  is 'Tenant admins/internal users, assigned drivers, and explicitly scoped portal users may read fiscal documents.';
