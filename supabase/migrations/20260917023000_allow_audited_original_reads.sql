-- Split blanket quarantine denials so the audited, short-lived read policies can take effect.
drop policy if exists payable_xml_browser_deny on storage.objects;
create policy payable_xml_read_boundary on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'payable-xml-quarantine' or (auth.role()='authenticated' and payable_xml_private.can_read_original(name)));
create policy payable_xml_no_browser_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'payable-xml-quarantine');
create policy payable_xml_no_browser_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'payable-xml-quarantine') with check(bucket_id<>'payable-xml-quarantine');
create policy payable_xml_no_browser_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'payable-xml-quarantine');

drop policy if exists quarantine_browser_deny on storage.objects;
create policy quarantine_read_boundary on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'upload-quarantine' or (auth.role()='authenticated' and secure_upload_private.can_read_statement_original(name)));
create policy quarantine_no_browser_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'upload-quarantine');
create policy quarantine_no_browser_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'upload-quarantine') with check(bucket_id<>'upload-quarantine');
create policy quarantine_no_browser_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'upload-quarantine');
