import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '@/hooks/useTenant';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export function DriverTenantSwitcher() {
  const { currentTenant, memberships, activateTenantId, switchingTenant, tenantContextError } = useTenant();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const companies = memberships.filter(member => member.role === 'driver');
  if (companies.length < 2 || !currentTenant) return null;

  async function changeCompany(id: string) {
    if (!online || pending || switchingTenant || id === currentTenant?.id) return;
    setPending(true);
    setError(null);
    try {
      if (await activateTenantId(id)) navigate('/driver', { replace: true });
      else setError('Não foi possível trocar a empresa. Tente novamente.');
    } catch {
      setError('Não foi possível trocar a empresa. Tente novamente.');
    } finally {
      setPending(false);
    }
  }

  return <div className="border-b bg-card px-4 py-2">
    <label className="flex items-center gap-3 text-sm">
      <span>Empresa</span>
      <select aria-label="Empresa do motorista" value={currentTenant.id}
        disabled={!online || pending || switchingTenant}
        onChange={event => void changeCompany(event.target.value)}
        className="min-h-11 flex-1 rounded-md border bg-background px-3 text-foreground disabled:opacity-60">
        {companies.map(member => <option key={member.tenant_id} value={member.tenant_id}>{member.tenants.name}</option>)}
      </select>
    </label>
    {!online && <p className="text-xs text-muted-foreground">Conecte-se à internet para trocar de empresa.</p>}
    {(error || tenantContextError) && <p role="alert" className="text-sm text-destructive">{tenantContextError || error}</p>}
  </div>;
}
