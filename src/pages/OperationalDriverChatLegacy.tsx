import { useState } from 'react';
import { DriverConversation } from '@/components/driver/DriverConversation';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useDrivers } from '@/hooks/useDrivers';
import { useTenant } from '@/hooks/useTenant';

const CHAT_ROLES = new Set(['owner', 'admin', 'operator']);

export default function OperationalDriverChat() {
  const { user } = useAuth();
  const { currentTenant, currentRole, loading } = useTenant();
  const allowed = !loading && !!user && !!currentTenant && CHAT_ROLES.has(currentRole ?? '');
  const scope = `${currentTenant?.id ?? ''}:${user?.id ?? ''}:${currentRole ?? ''}`;
  if (loading) return <p role="status">Carregando acesso ao chat...</p>;
  if (!allowed) return <p role="alert">Sem acesso ao chat operacional neste tenant.</p>;
  return <ChatPage key={scope} scope={scope} />;
}

function ChatPage({ scope }: { scope: string }) {
  const drivers = useDrivers({ includeInactive: true });
  const [driverId, setDriverId] = useState('');
  const selected = !drivers.error ? drivers.data?.find(driver => driver.id === driverId) : undefined;

  return <div className="space-y-4">
    <div>
      <h1 className="text-2xl font-semibold">Chat com motoristas</h1>
      <p className="text-sm text-muted-foreground">Converse com um motorista da empresa atual, mesmo sem ocorrência aberta.</p>
    </div>
    {drivers.error ? <div role="alert" className="space-y-2">
      <p>Não foi possível carregar os motoristas. Atualize a consulta para tentar novamente.</p>
      <Button onClick={() => { void drivers.refetch(); }}>Tentar novamente</Button>
    </div> : <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <label htmlFor="operational-chat-driver" className="text-sm font-medium">Motorista</label>
        <select id="operational-chat-driver" className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={selected?.id ?? ''} disabled={drivers.isPending}
          onChange={event => setDriverId(event.target.value)}>
          <option value="">Selecione um motorista</option>
          {drivers.data?.map(driver => <option key={driver.id} value={driver.id}>
            {driver.name}{driver.active ? '' : ' (inativo)'}
          </option>)}
        </select>
      </div>
      <Button variant="outline" disabled={drivers.isFetching} onClick={() => { void drivers.refetch(); }}>
        Atualizar motoristas
      </Button>
    </div>}
    {drivers.isPending && <p role="status">Carregando motoristas...</p>}
    {!drivers.error && !drivers.isPending && drivers.data?.length === 0 && <p>Nenhum motorista disponível nesta empresa.</p>}
    {selected && <section aria-label={`Conversa com ${selected.name}`} className="rounded-lg border">
      <h2 className="border-b p-3 font-medium">{selected.name}</h2>
      <DriverConversation key={`${scope}:${selected.id}`} driverId={selected.id} />
    </section>}
  </div>;
}
