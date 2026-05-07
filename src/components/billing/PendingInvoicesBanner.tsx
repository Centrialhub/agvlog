import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { usePendingInvoices } from '@/hooks/usePendingInvoices';

/**
 * Banner persistente exibido nas telas de Billing/Monitor/Consulta CT-e.
 * Avisa o usuário sobre NF-e elegíveis sem CT-e gerado e leva direto pro
 * fluxo de faturamento já preparado para agrupar essas notas.
 */
export function PendingInvoicesBanner({ from }: { from?: 'billing' | 'monitor' | 'search' }) {
  const { data, isLoading } = usePendingInvoices();
  if (isLoading || !data || data.count === 0) return null;

  const valueFmt = data.totalValue.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  const oldestDays = data.oldestIssueDate
    ? Math.floor((Date.now() - new Date(data.oldestIssueDate).getTime()) / 86_400_000)
    : null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {data.count} NF-e {data.count === 1 ? 'pendente' : 'pendentes'} de faturamento • {valueFmt}
          </p>
          {oldestDays !== null && oldestDays > 0 && (
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
              Mais antiga há {oldestDays} {oldestDays === 1 ? 'dia' : 'dias'} sem CT-e gerado.
            </p>
          )}
        </div>
      </div>
      {from !== 'billing' && (
        <Link
          to="/billing?focus=pending"
          className="inline-flex items-center gap-1 text-sm font-medium text-amber-900 dark:text-amber-200 hover:underline"
        >
          Ir para Faturamento <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}