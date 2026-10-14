import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  from: string;
  to: string;
  today: string;
  timeZone: string;
  error: string | null;
  disabled: boolean;
  onChange: (from: string, to: string) => void;
}

export function PendingGroupImportDates({ from, to, today, timeZone, error, disabled, onChange }: Props) {
  const id = useId();
  return <fieldset disabled={disabled} className="space-y-2 rounded-md border border-border p-3">
    <legend className="px-1 text-sm font-medium">Data de importação do XML</legend>
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div className="space-y-1">
        <Label htmlFor={id + '-from'}>Importação de</Label>
        <Input id={id + '-from'} type="date" value={from} aria-invalid={!!error} aria-describedby={id + '-help'}
          onChange={event => onChange(event.target.value, to)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={id + '-to'}>Importação até</Label>
        <Input id={id + '-to'} type="date" value={to} aria-invalid={!!error} aria-describedby={id + '-help'}
          onChange={event => onChange(from, event.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => onChange(today, today)}>Importados hoje</Button>
        <Button type="button" variant="ghost" disabled={disabled || (!from && !to)} onClick={() => onChange('', '')}>Limpar datas</Button>
      </div>
    </div>
    <p id={id + '-help'} className="text-xs text-muted-foreground">Considera a entrada do XML no sistema, não a emissão ou o faturamento da NF. Fuso da empresa: {timeZone}.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </fieldset>;
}
