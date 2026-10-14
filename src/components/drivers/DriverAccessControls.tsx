import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { normalizeDriverUsername, validateDriverPassword } from '@/lib/auth/driverCredentials';
import { driverAccessRequest, driverCredentialStatusRequest, type DriverAccessState } from '@/lib/auth/driverAccess';
import { useRefreshDriverAccess } from '@/hooks/useRefreshDriverAccess';

type Reconciliation = { phase: 'submitting' | 'unconfirmed'; requestId?: string };

export function DriverAccessControls({ tenantId, driverId, userId, onCreated, onBusyChange }: { tenantId: string; driverId?: string; userId?: string; onCreated?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const { user } = useAuth();
  const mounted = useRef(true);
  const submitting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const toast = useSonnerToast();
  const refresh = useRefreshDriverAccess();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const target = driverId ? { driver_id: driverId } : { user_id: userId };
  const queryClient = useQueryClient();
  const reconciliationKey = ['driver_access_reconciliation', tenantId, driverId, userId, user?.id];
  const reconciliationStorageKey = JSON.stringify(reconciliationKey);
  const remember = (value: Reconciliation | null, required = false) => {
    try {
      if(value) sessionStorage.setItem(reconciliationStorageKey,JSON.stringify(value));
      else sessionStorage.removeItem(reconciliationStorageKey);
    } catch {
      if(required) throw new Error('Não foi possível registrar a solicitação neste navegador. Reabra a tela antes de alterar credenciais.');
    }
    queryClient.setQueryData(reconciliationKey,value);
  };
  // Keep uncertainty across close/reopen, separately from stale inspection data.
  const reconciliation = useQuery<Reconciliation | null>({
    queryKey: reconciliationKey, queryFn: async () => null, enabled: false, initialData: () => {
      try {
        const saved=JSON.parse(sessionStorage.getItem(reconciliationStorageKey)??'null');
        if(saved && typeof saved.requestId==='string') return {phase:'unconfirmed',requestId:saved.requestId};
      } catch { /* A new mutation requires a successful durable write below. */ }
      return null;
    }, gcTime: Infinity,
  });
  const query = useQuery({
    queryKey: ['driver_access', tenantId, driverId, userId, user?.id],
    queryFn: async () => {
      const pending = queryClient.getQueryData<Reconciliation | null>(reconciliationKey);
      if(pending?.phase==='unconfirmed' && pending.requestId) {
        await driverCredentialStatusRequest({tenant_id:tenantId,...target,request_id:pending.requestId});
      }
      const inspected = await driverAccessRequest<DriverAccessState>({ tenant_id: tenantId, ...target, action: 'inspect', version: 3 });
      if (!['none', 'managed', 'legacy', 'linked'].includes(inspected.kind)) throw new Error('O serviço não confirmou o acesso.');
      // An inspection started before settlement cannot confirm the write outcome.
      if (pending?.phase === 'unconfirmed' && queryClient.getQueryData(reconciliationKey) === pending) remember(null);
      if(!pending && inspected.command_pending && inspected.pending_request_id)
        remember({phase:'unconfirmed',requestId:inspected.pending_request_id});
      return inspected;
    },
    retry: false,
  });
  const state = query.data;
  useEffect(() => { setPassword(''); setConfirmation(''); }, [state?.kind, tenantId, driverId, userId, user?.id]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!state || query.isError || query.fetchStatus !== 'idle' || queryClient.getQueryData(reconciliationKey) || submitting.current || state.command_pending || state.kind === 'linked' || (state.kind === 'managed' && !state.active)
      || (state.kind==='legacy' && !(state.version===3 && state.capabilities?.change_identity))
      || (state.capabilities && !(state.kind === 'none' ? state.capabilities.create_access : state.kind==='legacy' ? state.capabilities.change_identity : state.capabilities.change_password))) return;
    let attempted = false;
    let created = false;
    const requestId=state.kind==='none'?undefined:crypto.randomUUID();
    try {
      if (password !== confirmation) throw new Error('As senhas não coincidem.');
      validateDriverPassword(password);
      const normalized = state.kind !== 'managed' ? normalizeDriverUsername(username) : state.username;
      remember({ phase: 'submitting',requestId },!!requestId);
      attempted = true; submitting.current = true;
      setBusy(true); onBusyChange?.(true);
      await driverAccessRequest({ tenant_id: tenantId, ...target, action: state.kind === 'none' ? 'create' : state.kind==='legacy'?'convert':'password', username: normalized, password,
        ...(requestId?{request_id:requestId}:{}) });
      created = state.kind === 'none';
      if (mounted.current) toast.success(created ? 'Conta de motorista criada.' : state.kind==='legacy'?'Acesso convertido para usuário.':'Senha do motorista alterada.');
    } catch (error) {
      if (mounted.current) toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o acesso.');

    } finally {
      if (attempted) {
        remember({ phase: 'unconfirmed',requestId });
        submitting.current = false;
        if (mounted.current) { setPassword(''); setConfirmation(''); setBusy(false); }
        // The parent must recover even if its selected registry disappeared.
        onBusyChange?.(false);
        try { await refresh(); } catch { /* Keep the confirmation barrier until a successful inspection. */ }
        if (created && mounted.current) onCreated?.();
      }
    }
  };
  if (query.isPending) return <p className="text-sm">Consultando acesso...</p>;
  if (query.isError) return <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{query.error.message}</p><Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></div>;
  if(!busy && (reconciliation.data || state?.command_pending)) return <div role="status" className="space-y-2 text-sm">
    <p>Há uma solicitação de credenciais aguardando confirmação. Verifique o resultado antes de iniciar outra alteração.</p>
    <Button type="button" variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Verificar acesso</Button>
  </div>;
  if (state?.kind === 'linked' || (state?.capabilities && !state.capabilities.create_access && !state.capabilities.change_password && !state.capabilities.change_identity)) return <div role="status" className="space-y-2 text-sm">
    <p>{state.kind === 'none' ? 'Este cadastro está sem conta de acesso.' : 'Conta de acesso vinculada.'}</p>
    {state.kind !== 'none' && <p>Vínculo nesta empresa: {state.active ? 'ativo' : 'inativo'}.</p>}
    <p>O cadastro do motorista e a conta de acesso são gerenciados separadamente.</p>
    <p>{state.kind === 'none' ? 'A criação de acesso requer um cadastro ativo.' : 'A alteração de credenciais não está disponível para este vínculo. Não exclua nem desvincule registros para liberar essa operação.'}</p>
  </div>;
  if (state?.kind === 'legacy' && !state.capabilities?.change_identity) return <p className="text-sm">Esta conta pertence ao modelo antigo. A conversão de acesso requer um fluxo que preserve os vínculos existentes. Não exclua nem desvincule o cadastro para trocar as credenciais.</p>;
  return <form className="space-y-3" onSubmit={save} aria-busy={busy}>
    {state?.version===3 && state.kind!=='none' && <p className="text-sm">{state.kind==='legacy'?'A conversão preserva a conta e seu histórico. ':''}A alteração de credenciais vale para todos os CNPJs desta operação vinculados ao motorista.</p>}
    {reconciliation.data && !busy && <div role="status" className="space-y-2 text-sm"><p>Confirme o resultado da operação antes de tentar novamente.</p><Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Verificar acesso</Button></div>}
    <div className="space-y-2">
      <Label htmlFor="driver-access-username">Usuário</Label>
      <Input id="driver-access-username" autoComplete="off" autoCapitalize="none" spellCheck={false} value={state?.kind === 'managed' ? state.username ?? '' : username} readOnly={state?.kind === 'managed'} disabled={busy} onChange={event => setUsername(event.target.value)} required />
      {state?.kind !== 'managed' && <p className="text-xs text-muted-foreground">De 3 a 40 caracteres. Use letras sem acento, números, ponto, hífen ou sublinhado. O usuário deve ser único.</p>}
    </div>
    {state?.kind === 'managed' && !state.active ? <p className="text-sm">Ative o membro na Equipe antes de trocar sua senha.</p> : <>
      <div className="space-y-2"><Label htmlFor="driver-access-password">{state?.kind === 'none' ? 'Senha inicial' : 'Nova senha'}</Label><Input id="driver-access-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required /><p className="text-xs text-muted-foreground">Use 12 ou mais caracteres, com maiúscula, minúscula e número.</p></div>
      <div className="space-y-2"><Label htmlFor="driver-access-confirmation">Confirmar senha</Label><Input id="driver-access-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} required /></div>
      <p className="text-xs text-muted-foreground">Informe o usuário e a senha ao motorista. As próximas trocas de senha serão feitas pelo painel operacional.</p>
      <Button type="submit" disabled={busy || query.fetchStatus !== 'idle' || !!reconciliation.data || !password || !confirmation || (state?.kind !== 'managed' && !username) || (state?.kind === 'none' && !driverId)}>{busy ? 'Salvando...' : state?.kind === 'none' ? 'Criar acesso' : state?.kind==='legacy'?'Converter acesso':'Trocar senha'}</Button>
    </>}
  </form>;
}
