import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { normalizeDriverUsername, validateDriverPassword } from '@/lib/auth/driverCredentials';
import { driverAccessRequest, type DriverAccessState } from '@/lib/auth/driverAccess';
import { useRefreshDriverAccess } from '@/hooks/useRefreshDriverAccess';

export function DriverAccessControls({ tenantId, driverId, userId }: { tenantId: string; driverId?: string; userId?: string }) {
  const toast = useSonnerToast();
  const refresh = useRefreshDriverAccess();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const target = driverId ? { driver_id: driverId } : { user_id: userId };
  const query = useQuery({
    queryKey: ['driver_access', tenantId, driverId, userId],
    queryFn: () => driverAccessRequest<DriverAccessState>({ tenant_id: tenantId, ...target, action: 'inspect' }),
    retry: false,
  });
  const state = query.data;
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!state || query.isFetching || busy || state.kind === 'legacy') return;
    try {
      if (password !== confirmation) throw new Error('As senhas não coincidem.');
      validateDriverPassword(password);
      const normalized = state.kind === 'none' ? normalizeDriverUsername(username) : state.username;
      setBusy(true);
      await driverAccessRequest({ tenant_id: tenantId, ...target, action: state.kind === 'none' ? 'create' : 'password', username: normalized, password });
      setPassword(''); setConfirmation('');
      toast.success(state.kind === 'none' ? 'Conta de motorista criada.' : 'Senha do motorista alterada.');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o acesso.');
    } finally { setBusy(false); }
  };
  if (query.isPending) return <p className="text-sm">Consultando acesso...</p>;
  if (query.isError) return <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{query.error.message}</p><Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></div>;
  if (state?.kind === 'legacy') return <p className="text-sm">Esta conta pertence ao modelo antigo. Use “Excluir contas antigas” na tela de Motoristas e crie uma nova conta neste cadastro.</p>;
  return <form className="space-y-3" onSubmit={save} aria-busy={busy}>
    <div className="space-y-2">
      <Label htmlFor="driver-access-username">Usuário</Label>
      <Input id="driver-access-username" autoComplete="off" autoCapitalize="none" spellCheck={false} value={state?.kind === 'managed' ? state.username ?? '' : username} readOnly={state?.kind === 'managed'} disabled={busy} onChange={event => setUsername(event.target.value)} required />
      {state?.kind === 'none' && <p className="text-xs text-muted-foreground">De 3 a 40 caracteres. Use letras sem acento, números, ponto, hífen ou sublinhado. O usuário deve ser único.</p>}
    </div>
    {state?.kind === 'managed' && !state.active ? <p className="text-sm">Ative o membro na Equipe antes de trocar sua senha.</p> : <>
      <div className="space-y-2"><Label htmlFor="driver-access-password">{state?.kind === 'none' ? 'Senha inicial' : 'Nova senha'}</Label><Input id="driver-access-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required /><p className="text-xs text-muted-foreground">Use 12 ou mais caracteres, com maiúscula, minúscula e número.</p></div>
      <div className="space-y-2"><Label htmlFor="driver-access-confirmation">Confirmar senha</Label><Input id="driver-access-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} required /></div>
      <p className="text-xs text-muted-foreground">Informe o usuário e a senha ao motorista. As próximas trocas de senha serão feitas pelo painel operacional.</p>
      <Button type="submit" disabled={busy || query.isFetching || !password || !confirmation || (state?.kind === 'none' && (!username || !driverId))}>{busy ? 'Salvando...' : state?.kind === 'none' ? 'Criar acesso' : 'Trocar senha'}</Button>
    </>}
  </form>;
}
