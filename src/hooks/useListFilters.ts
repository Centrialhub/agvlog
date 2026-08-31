import { useSearchParams } from 'react-router-dom';

/** Reload and back/forward restore the same filters without overwriting tab parameters. */
export function useListFilters<T extends Record<string, string>>(defaults: T, prefix = 'f_') {
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, params.get(`${prefix}${key}`) ?? value])) as T;
  const setFilter = (key: keyof T & string, value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (value === defaults[key]) next.delete(`${prefix}${key}`);
    else next.set(`${prefix}${key}`, value);
    return next;
  }, { replace: true });
  const resetFilters = () => setParams(previous => {
    const next = new URLSearchParams(previous);
    for (const key of Object.keys(defaults)) next.delete(`${prefix}${key}`);
    return next;
  }, { replace: true });
  const activeCount = Object.keys(defaults).filter(key => filters[key] !== defaults[key]).length;
  return { filters, setFilter, resetFilters, activeCount };
}
