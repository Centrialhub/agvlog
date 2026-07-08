import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

export function PortalClientSelector() {
  const { clients, selectedClientId, setSelectedClientId } = usePortalClientScope();
  if (!clients || clients.length <= 1) return null;
  const value = selectedClientId ?? '__all__';
  return (
    <Select
      value={value}
      onValueChange={(v) => setSelectedClientId(v === '__all__' ? null : v)}
    >
      <SelectTrigger className="h-8 w-[220px] text-xs">
        <SelectValue placeholder="Todos os clientes" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">Todos os clientes ({clients.length})</SelectItem>
        {clients.map((c) => (
          <SelectItem key={c.client_id} value={c.client_id}>
            {c.client_name ?? c.client_id.slice(0, 8)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
