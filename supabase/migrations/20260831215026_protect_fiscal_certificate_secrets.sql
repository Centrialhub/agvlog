create policy "Certificate secrets are service only"
  on public.fiscal_certificates
  for all to authenticated
  using (false)
  with check (false);
