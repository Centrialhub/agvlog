const DEFAULT_PAGE_SIZE = 500;

export interface PostgrestPage<T> {
  data: T[] | null;
  error: unknown;
}

/**
 * Reads a PostgREST result in explicit ranges so the API row ceiling can never
 * turn a complete-looking list into a silently truncated one.
 */
export async function fetchAllPostgrestPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PostgrestPage<T>>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error('O tamanho da página deve ser um inteiro positivo.');
  }

  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
