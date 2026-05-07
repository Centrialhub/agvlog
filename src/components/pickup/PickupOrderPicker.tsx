import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, PackageOpen, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { usePickupOrders, PickupOrder } from '@/hooks/usePickupOrders';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import NewPickupOrderDialog from './NewPickupOrderDialog';

interface PickupOrderPickerProps {
  value: string | null;
  noPickup: boolean;
  onChange: (pickupId: string | null, pickup: PickupOrder | null) => void;
  onNoPickupChange: (noPickup: boolean) => void;
}

export default function PickupOrderPicker({ value, noPickup, onChange, onNoPickupChange }: PickupOrderPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const { data: pickups = [], isLoading } = usePickupOrders({
    status: 'all',
    search: search.length >= 2 ? search : undefined,
  });

  const selected = useMemo(() => pickups.find(p => p.id === value) || null, [pickups, value]);

  const filtered = useMemo(() => {
    if (!search) return pickups.slice(0, 50);
    const s = search.toLowerCase();
    return pickups.filter(p =>
      (p.pickup_number || '').toLowerCase().includes(s) ||
      (p.remitter_name || '').toLowerCase().includes(s) ||
      (p.driver_name_snapshot || '').toLowerCase().includes(s) ||
      (p.vehicle_plate_snapshot || '').toLowerCase().includes(s),
    ).slice(0, 50);
  }, [pickups, search]);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <PackageOpen className="h-4 w-4 text-primary" />
        <h4 className="font-medium text-sm">Vínculo de Coleta</h4>
        <Badge variant="outline" className="text-xs">Opcional → marque "sem coleta" se não houver</Badge>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="no-pickup"
          checked={noPickup}
          onCheckedChange={(checked) => {
            const v = Boolean(checked);
            onNoPickupChange(v);
            if (v) onChange(null, null);
          }}
        />
        <Label htmlFor="no-pickup" className="text-sm cursor-pointer">
          Não possui coleta (mercadoria veio por entrega direta)
        </Label>
      </div>

      {!noPickup && (
        <div className="flex items-center gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="flex-1 justify-between font-normal"
              >
                {selected ? (
                  <span className="truncate">
                    Coleta nº {selected.pickup_number}
                    {selected.driver_name_snapshot && ` • ${selected.driver_name_snapshot}`}
                    {selected.remitter_name && ` • ${selected.remitter_name}`}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Buscar coleta por nº, motorista ou fornecedor...</span>
                )}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[520px] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Digite nº, motorista, fornecedor ou placa..."
                  value={search}
                  onValueChange={setSearch}
                />
                <CommandList>
                  <CommandEmpty>
                    {isLoading ? 'Carregando...' : 'Nenhuma coleta encontrada.'}
                  </CommandEmpty>
                  <CommandGroup>
                    {filtered.map((p) => (
                      <CommandItem
                        key={p.id}
                        value={p.id}
                        onSelect={() => {
                          onChange(p.id, p);
                          setOpen(false);
                        }}
                      >
                        <Check className={cn('mr-2 h-4 w-4', value === p.id ? 'opacity-100' : 'opacity-0')} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Coleta nº {p.pickup_number}</span>
                            <Badge variant="secondary" className="text-[10px]">{p.status}</Badge>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {p.pickup_at && format(new Date(p.pickup_at), 'dd/MM/yyyy', { locale: ptBR })}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {p.remitter_name || '—'}
                            {p.driver_name_snapshot && ` • Motorista: ${p.driver_name_snapshot}`}
                            {p.vehicle_plate_snapshot && ` • ${p.vehicle_plate_snapshot}`}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {selected && (
            <Button variant="ghost" size="icon" onClick={() => onChange(null, null)} title="Limpar seleção">
              <X className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nova Coleta
          </Button>
        </div>
      )}

      {selected && !noPickup && (
        <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
          <div><strong>Remetente esperado:</strong> {selected.remitter_name || '—'} {selected.remitter_cnpj && `(${selected.remitter_cnpj})`}</div>
          <div className="text-muted-foreground">
            XMLs cujo remetente não bater com este serão <strong className="text-destructive">bloqueados</strong> na importação.
          </div>
        </div>
      )}

      <NewPickupOrderDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={(p) => { onChange(p.id, p); setShowCreate(false); }}
      />
    </div>
  );
}