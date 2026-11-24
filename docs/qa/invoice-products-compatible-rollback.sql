-- Operational stop for FUTURE expansion only; run only after a reviewed incident decision.
-- Keep data, column, current-attempt view and legacy-snapshot compatibility.
-- Do not restore the pre-column remainder function: it cannot compare old snapshots.
begin;
alter table public.load_items disable trigger zz_prepare_imported_product_item;
alter table public.load_items disable trigger zz_expand_imported_product_items;
commit;
