import { ArrowDownToLine, ArrowUpFromLine, Clock, DollarSign, Layers, Weight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { FiscalDocumentSummary } from '@/hooks/useFiscalDocuments';

export function FiscalDocumentSummaryCards({ summary }: { summary: FiscalDocumentSummary }) {
  const cards = [
    { label: 'NF-e Entrada', value: summary.inboundCount, icon: ArrowDownToLine, color: 'text-emerald-500' },
    { label: 'CT-e / Saída', value: summary.outboundCount, icon: ArrowUpFromLine, color: 'text-blue-500' },
    { label: 'Pendentes', value: summary.pendingCount, icon: Clock, color: 'text-amber-500' },
    { label: 'Valor Total', value: summary.totalValue > 0 ? `R$ ${summary.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—', icon: DollarSign, color: 'text-primary' },
    { label: 'Peso Total', value: summary.totalWeight > 0 ? `${summary.totalWeight.toLocaleString('pt-BR')} kg` : '—', icon: Weight, color: 'text-muted-foreground' },
    { label: 'Paletes', value: summary.totalPallets, icon: Layers, color: 'text-muted-foreground' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map(card => (
        <Card key={card.label} className="border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <card.icon className={`h-5 w-5 shrink-0 ${card.color}`} />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground truncate">{card.label}</p>
              <p className="text-lg font-semibold text-foreground">{card.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
