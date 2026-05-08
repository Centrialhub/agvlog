import { useId, useMemo } from 'react';
import { Input } from '@/components/ui/input';

// Aceita placa antiga (AAA0000) e Mercosul (AAA0A00). Validação só após 7 chars.
const PLATE_REGEX = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

interface PlateInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suggestions?: string[];
  className?: string;
}

export default function PlateInput({ value, onChange, placeholder, suggestions = [], className }: PlateInputProps) {
  const listId = useId();
  const opts = useMemo(
    () => Array.from(new Set(suggestions.map(s => (s || '').toUpperCase().trim()).filter(Boolean))).slice(0, 200),
    [suggestions],
  );
  const upper = (value || '').toUpperCase();
  const showError = upper.length === 7 && !PLATE_REGEX.test(upper);

  return (
    <div className="space-y-0.5">
      <Input
        list={listId}
        value={upper}
        onChange={e => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7))}
        placeholder={placeholder}
        maxLength={7}
        className={`h-8 text-xs uppercase tracking-wider ${showError ? 'border-destructive' : ''} ${className || ''}`}
        aria-invalid={showError}
      />
      <datalist id={listId}>
        {opts.map(p => <option key={p} value={p} />)}
      </datalist>
      {showError && (
        <p className="text-[10px] text-destructive">Formato inválido (ex.: ABC1D23 ou ABC1234)</p>
      )}
    </div>
  );
}