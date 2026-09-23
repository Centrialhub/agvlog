/**
 * `load_items` has both a legacy document FK and the tenant-scoped document FK.
 * PostgREST requires the relationship to be explicit or it returns PGRST201.
 */
export const LOAD_ITEM_FISCAL_DOCUMENT_RELATION =
  'fiscal_documents!load_items_fiscal_tenant_fkey' as const;

export function selectLoadItemFiscalDocument<const Fields extends string>(
  fields: Fields,
): `${typeof LOAD_ITEM_FISCAL_DOCUMENT_RELATION}(${Fields})` {
  return `${LOAD_ITEM_FISCAL_DOCUMENT_RELATION}(${fields})`;
}
