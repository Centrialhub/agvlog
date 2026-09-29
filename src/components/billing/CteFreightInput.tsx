import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

import { parseCteFreightAmount } from '@/lib/fiscal/cteFreightAmount';

/** Keep the user's decimal separator and unfinished text while typing. */
export function CteFreightInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(() => value.toFixed(2).replace('.', ','));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value.toFixed(2).replace('.', ','));
  }, [value, editing]);
  const invalid = text !== '' && parseCteFreightAmount(text) === null;
  return <Input id="cte-freight-value" aria-label="Frete peso — frete base (R$)"
    type="text" inputMode="decimal" value={text} aria-invalid={invalid}
    onFocus={() => setEditing(true)}
    onChange={(event) => {
      setText(event.target.value);
      // Invalid/empty input must not leave an earlier amount eligible for issue.
      onChange(parseCteFreightAmount(event.target.value) ?? 0);
    }}
    onBlur={() => { if (!invalid) setEditing(false); }} />;
}
