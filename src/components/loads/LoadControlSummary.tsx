import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { LoadReportKind } from '@/lib/loadReports/loadControlPdf';

export const REPORT_TITLES: Record<LoadReportKind, string> = {
  summary: 'Resumo de Cargas Recebidas', detailed: 'Relatório Detalhado da Carga',
  open: 'Cargas em Aberto', paid: 'Cargas Pagas',
  by_client: 'Por Cliente', by_city: 'Por Cidade', unloading: 'Descargas',
};

export function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warning' | 'destructive' }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${tone === 'warning' ? 'text-amber-600' : tone === 'destructive' ? 'text-destructive' : ''}`}>{value}</div>
    </CardContent></Card>
  );
}
