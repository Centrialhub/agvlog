import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, ChevronDown, ChevronUp, Printer, Loader2 } from 'lucide-react';
import { printRomaneioRoutes, type RomaneioDoc } from '@/lib/romaneioPrint';

interface Props {
  loadId: string;
  loadNumber?: string | null;
  vehiclePlate?: string | null;
  driverName?: string | null;
}

export default function DriverLoadNotes({ loadId, loadNumber, vehiclePlate, driverName }: Props) {
  const [open, setOpen] = useState(false);

  const { data: docs = [], isLoading, error } = useQuery({
    queryKey: ['driver_load_fiscal_docs', loadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, issue_date, recipient, recipient_city, recipient_state, recipient_neighborhood, remitter, value, weight_kg, volume_count, pallet_count')
        .eq('load_id', loadId)
        .order('recipient_city', { ascending: true })
        .order('invoice_number', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!loadId,
  });

  const handlePrint = () => {
    const romaneioDocs: RomaneioDoc[] = docs.map((d) => ({
      city: d.recipient_city || '',
      state: d.recipient_state || '',
      remetente: d.remitter || '',
      destinatario: d.recipient || '',
      bairro: d.recipient_neighborhood || '',
      nfNumber: d.invoice_number || '',
      emissao: d.issue_date ? new Date(d.issue_date).toLocaleDateString('pt-BR') : '',
      valor: Number(d.value) || 0,
      peso: Number(d.weight_kg) || 0,
      volumes: Number(d.volume_count) || 0,
    }));
    printRomaneioRoutes(
      [
        {
          routeName: `Carga ${loadNumber || ''}`.trim(),
          vehicleInfo: vehiclePlate ? `Veículo: ${vehiclePlate}` : undefined,
          driverInfo: driverName ? `Motorista: ${driverName}` : undefined,
          docs: romaneioDocs,
        },
      ],
      `Romaneio ${loadNumber || ''}`,
    );
  };

  const totalValue = docs.reduce((sum, document) => sum + (Number(document.value) || 0), 0);
  const totalWeight = docs.reduce((sum, document) => sum + (Number(document.weight_kg) || 0), 0);

  return (
    <div className="border-t pt-2 mt-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary transition-colors"
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Notas fiscais</span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
            {isLoading ? '…' : docs.length}
          </Badge>
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] px-2"
          disabled={isLoading || docs.length === 0}
          onClick={handlePrint}
        >
          <Printer className="h-3 w-3 mr-1" /> Romaneio
        </Button>
      </div>

      {open && (
        <div className="space-y-1.5">
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Carregando notas…
            </div>
          )}
          {!isLoading && error && (
            <p className="text-[11px] text-destructive italic py-1">
              Erro ao carregar notas: {(error as Error).message}
            </p>
          )}
          {!isLoading && !error && docs.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic py-1">
              Nenhuma nota fiscal vinculada a esta carga.
            </p>
          )}
          {!isLoading && !error && docs.length > 0 && (
            <>
              <div className="max-h-56 overflow-y-auto rounded border bg-muted/30 divide-y">
                {docs.map((d) => (
                  <div key={d.id} className="p-2 text-[11px] space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">NF {d.invoice_number || '—'}</span>
                      <span className="text-muted-foreground">
                        {Number(d.value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                    </div>
                    <div className="text-muted-foreground truncate">{d.recipient || '—'}</div>
                    <div className="text-muted-foreground text-[10px]">
                      {(d.recipient_city || '—')}{d.recipient_state ? `/${d.recipient_state}` : ''}
                      {d.weight_kg ? ` · ${Number(d.weight_kg).toLocaleString('pt-BR')} kg` : ''}
                      {d.volume_count ? ` · ${d.volume_count} vol.` : ''}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
                <span>{docs.length} notas</span>
                <span>
                  Total: {totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  {totalWeight ? ` · ${totalWeight.toLocaleString('pt-BR')} kg` : ''}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
