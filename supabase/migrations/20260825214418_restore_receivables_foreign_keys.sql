alter table public.receivables
  add constraint receivables_tenant_id_fkey foreign key (tenant_id) references public.tenants(id),
  add constraint receivables_order_id_fkey foreign key (order_id) references public.orders(id) on delete set null,
  add constraint receivables_fiscal_document_id_fkey foreign key (fiscal_document_id) references public.fiscal_documents(id) on delete set null,
  add constraint receivables_load_id_fkey foreign key (load_id) references public.loads(id) on delete set null,
  add constraint receivables_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null,
  add constraint receivables_client_invoice_id_fkey foreign key (client_invoice_id) references public.client_invoices(id) on delete set null,
  add constraint receivables_closing_report_id_fkey foreign key (closing_report_id) references public.closing_reports(id) on delete set null;

create index if not exists idx_receivables_tenant_id on public.receivables (tenant_id);
create index if not exists idx_receivables_order_id on public.receivables (order_id) where order_id is not null;
create index if not exists idx_receivables_fiscal_document_id on public.receivables (fiscal_document_id) where fiscal_document_id is not null;
create index if not exists idx_receivables_load_id on public.receivables (load_id) where load_id is not null;
create index if not exists idx_receivables_client_id on public.receivables (client_id) where client_id is not null;
create index if not exists idx_receivables_client_invoice_id on public.receivables (client_invoice_id) where client_invoice_id is not null;
create index if not exists idx_receivables_closing_report_id on public.receivables (closing_report_id) where closing_report_id is not null;
