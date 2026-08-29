import { useEffect, useMemo, useState } from 'react';

export interface PaginationResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  totalCount: number;
  start: number;
  end: number;
  setPage: (page: number) => void;
}

export function paginateItems<T>(items: T[], page: number, pageSize: number) {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const startIndex = (safePage - 1) * safePageSize;

  return {
    items: items.slice(startIndex, startIndex + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    pageCount,
    totalCount: items.length,
    start: items.length === 0 ? 0 : startIndex + 1,
    end: Math.min(items.length, startIndex + safePageSize),
  };
}

export function usePagination<T>(
  items: T[],
  options: { pageSize?: number; resetKey?: string } = {},
): PaginationResult<T> {
  const pageSize = options.pageSize ?? 50;
  const [page, setPageState] = useState(1);

  useEffect(() => setPageState(1), [options.resetKey]);

  const pagination = useMemo(
    () => paginateItems(items, page, pageSize),
    [items, page, pageSize],
  );

  useEffect(() => {
    if (page !== pagination.page) setPageState(pagination.page);
  }, [page, pagination.page]);

  return {
    ...pagination,
    setPage: (nextPage) => setPageState(
      Math.min(Math.max(1, Math.floor(nextPage)), pagination.pageCount),
    ),
  };
}
