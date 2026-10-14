import { useState, type RefObject } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin, useTenant } from '@/hooks/useTenant';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DriverAccessControls } from './DriverAccessControls';

type ExistingDriver = { id: string; tenant_id: string; name: string; active: boolean; user_id: string | null };
type Props = { tenantId: string; actorId: string; drivers: readonly ExistingDriver[]; returnFocusRef: RefObject<HTMLButtonElement>; onClose: () => void };

export function CreateDriverAccessDialog({ tenantId, actorId, drivers, returnFocusRef, onClose }: Props) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const [driverId, setDriverId] = useState('');
  const [busyRequest, setBusyRequest] = useState<string | null>(null);
  const targetKey = tenantId + ':' + actorId + ':' + driverId;
  const busy = busyRequest === targetKey;
  const eligible = drivers.filter(driver => driver.tenant_id === tenantId && driver.active && !driver.user_id);
  // Keep the selected registry visible if reconciliation discovers its new account.
  const selected = drivers.find(driver => driver.id === driverId && driver.tenant_id === tenantId && driver.active);
  const options = selected?.user_id ? [...eligible, selected] : eligible;
  if (!isAdmin || user?.id !== actorId || currentTenant?.id !== tenantId) return null;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto" aria-busy={busy} onCloseAutoFocus={event => { event.preventDefault(); returnFocusRef.current?.focus(); }}>
      <DialogHeader>
        <DialogTitle>Criar conta de acesso</DialogTitle>
        <DialogDescription>Selecione um motorista já cadastrado para definir o usuário e a senha do aplicativo.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="driver-access-driver">Motorista cadastrado</Label>
        <Select value={driverId} disabled={busy || options.length === 0} onValueChange={id => { if (eligible.some(driver => driver.id === id)) setDriverId(id); }}>
          <SelectTrigger id="driver-access-driver" aria-label="Motorista cadastrado"><SelectValue placeholder="Selecione o motorista" /></SelectTrigger>
          <SelectContent>{options.map(driver => <SelectItem key={driver.id} value={driver.id}>{driver.name}</SelectItem>)}</SelectContent>
        </Select>
        {options.length === 0 && <p role="status" className="text-sm text-muted-foreground">Nenhum motorista ativo sem conta está disponível nesta empresa. Use “Cadastrar motorista” para criar o cadastro ou gerencie o acesso de um motorista já vinculado.</p>}
      </div>
      {selected && <DriverAccessControls key={tenantId + ':' + actorId + ':' + selected.id} tenantId={tenantId} driverId={selected.id} onBusyChange={value => setBusyRequest(current => value ? targetKey : current === targetKey ? null : current)} onCreated={onClose} />}
      <div className="flex justify-end"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button></div>
    </DialogContent>
  </Dialog>;
}
