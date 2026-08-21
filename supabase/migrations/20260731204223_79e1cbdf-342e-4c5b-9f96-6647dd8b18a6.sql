UPDATE public.tenants t
SET settings = coalesce(t.settings,'{}'::jsonb)
  || jsonb_build_object('insurance', (SELECT s.settings->'insurance' FROM public.tenants s WHERE s.id = '6e874e6e-5bca-486d-9928-bef0646989c4'))
  || coalesce(jsonb_build_object('company', (SELECT s.settings->'company' FROM public.tenants s WHERE s.id = '6e874e6e-5bca-486d-9928-bef0646989c4' AND s.settings ? 'company')), '{}'::jsonb)
WHERE t.id = 'db36dc9b-2bfb-4e3f-985b-ec4880b7ee97';