import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ClipboardCheck } from 'lucide-react';

const PRE_TRIP_ITEMS = [
  'Pneus em bom estado',
  'Nível de óleo verificado',
  'Água do radiador',
  'Luzes funcionando',
  'Freios testados',
  'Documentos do veículo',
  'Carga conferida e amarrada',
  'Espelhos ajustados',
];

const POST_TRIP_ITEMS = [
  'Veículo estacionado no local correto',
  'Chaves entregues',
  'Km registrado',
  'Avarias reportadas',
  'Veículo limpo',
];

function ChecklistSection({ title, items }: { title: string; items: string[] }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const toggle = (idx: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const allChecked = checked.size === items.length;

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{title}</p>
          {allChecked && (
            <span className="text-[10px] font-medium text-green-600">✓ Completo</span>
          )}
        </div>
        {items.map((item, i) => (
          <label
            key={i}
            className="flex items-center gap-2 text-xs cursor-pointer py-1"
          >
            <Checkbox checked={checked.has(i)} onCheckedChange={() => toggle(i)} />
            <span className={checked.has(i) ? 'line-through text-muted-foreground' : ''}>{item}</span>
          </label>
        ))}
      </CardContent>
    </Card>
  );
}

export default function DriverChecklist() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Checklist</h1>
      <ChecklistSection title="Pré-Viagem" items={PRE_TRIP_ITEMS} />
      <ChecklistSection title="Pós-Viagem" items={POST_TRIP_ITEMS} />
    </div>
  );
}
