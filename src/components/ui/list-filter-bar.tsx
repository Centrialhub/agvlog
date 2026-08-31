import { useId, type ReactNode } from 'react';
import { Filter, RotateCcw, Search, X } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

export interface ListFilterField {
  key: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: { value: string; label: string }[];
  placeholder?: string;
  type?: 'search' | 'date' | 'text';
  min?: string;
  max?: string;
}

interface Props {
  fields: ListFilterField[];
  onReset: () => void;
  activeCount: number;
  resultCount?: number;
  totalCount?: number;
  loading?: boolean;
  description?: string;
  children?: ReactNode;
}

export function ListFilterBar({ fields, onReset, activeCount, resultCount, totalCount, loading, description, children }: Props) {
  const id = useId();
  const invalidDates = fields.filter(field => field.type === 'date' && field.value && ((field.min && field.value < field.min) || (field.max && field.value > field.max)));
  return <section aria-label="Filtros da listagem" className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="inline-flex items-center gap-2 text-sm font-medium"><Filter aria-hidden="true" className="h-4 w-4 text-primary" />Filtros{activeCount > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{activeCount} {activeCount === 1 ? 'ativo' : 'ativos'}</span>}</span>
      <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={activeCount === 0} className="h-10 text-xs"><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Limpar filtros</Button>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {fields.map(field => {
        const fieldId = `${id}-${field.key}`;
        return <div key={field.key} className={field.type === 'search' ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
          <Label htmlFor={fieldId} className="mb-1.5 block text-xs text-muted-foreground">{field.label}</Label>
          {field.options ? <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger id={fieldId} aria-label={field.label} className="h-10"><SelectValue /></SelectTrigger>
            <SelectContent>{field.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select> : <div className="relative">
            {field.type === 'search' && <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />}
            <Input id={fieldId} type={field.type === 'date' ? 'date' : 'text'} value={field.value} onChange={event => field.onChange(event.target.value)} placeholder={field.placeholder} min={field.min} max={field.max} aria-invalid={invalidDates.includes(field) || undefined} aria-describedby={invalidDates.includes(field) ? `${id}-dates` : undefined} className={`h-10 ${field.type === 'search' ? 'pl-9 pr-9' : ''}`} />
            {field.type === 'search' && field.value && <button type="button" aria-label={`Limpar ${field.label.toLowerCase()}`} onClick={() => field.onChange('')} className="absolute right-0.5 top-0.5 rounded p-2 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" /></button>}
          </div>}
        </div>;
      })}
    </div>
    {invalidDates.length > 0 && <p id={`${id}-dates`} role="alert" className="text-xs text-destructive">A data final deve ser igual ou posterior à inicial.</p>}
    {children}
    <div role="status" aria-label="Resultado dos filtros" aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {loading ? <span>Carregando resultados…</span> : resultCount !== undefined && <span>{resultCount.toLocaleString('pt-BR')}{totalCount !== undefined ? ` de ${totalCount.toLocaleString('pt-BR')}` : ''} registros{activeCount > 0 ? ' encontrados' : ''}</span>}
      {description && <span>{description}</span>}
      {!loading && resultCount === 0 && activeCount > 0 && <button type="button" onClick={onReset} className="font-medium text-primary underline underline-offset-4">Limpar filtros e tentar novamente</button>}
    </div>
  </section>;
}
