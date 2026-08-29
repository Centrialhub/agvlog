import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface DataPaginationProps {
  page: number;
  pageCount: number;
  totalCount: number;
  start: number;
  end: number;
  onPageChange: (page: number) => void;
}

export function DataPagination({
  page,
  pageCount,
  totalCount,
  start,
  end,
  onPageChange,
}: DataPaginationProps) {
  if (totalCount === 0 || pageCount <= 1) return null;

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"
      aria-label="Paginação dos resultados"
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Exibindo {start}–{end} de {totalCount}
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Primeira página"
          disabled={page === 1}
          onClick={() => onPageChange(1)}
        >
          <ChevronFirst className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Página anterior"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="min-w-24 text-center text-sm">
          Página {page} de {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Próxima página"
          disabled={page === pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Última página"
          disabled={page === pageCount}
          onClick={() => onPageChange(pageCount)}
        >
          <ChevronLast className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
