import { Button } from '@/components/ui/button';

interface FiscalListPaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

export function FiscalListPagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
}: FiscalListPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  if (totalItems <= pageSize) return null;

  const firstItem = (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-2" aria-label="Paginação da consulta fiscal">
      <p className="text-xs text-muted-foreground">
        Exibindo {firstItem}–{lastItem} de {totalItems}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Anterior
        </Button>
        <span className="text-xs tabular-nums" aria-live="polite">
          Página {currentPage} de {totalPages}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Próxima
        </Button>
      </div>
    </nav>
  );
}
