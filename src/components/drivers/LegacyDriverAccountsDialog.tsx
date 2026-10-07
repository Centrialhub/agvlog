import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { driverAccessRequest } from '@/lib/auth/driverAccess';
import { useRefreshDriverAccess } from '@/hooks/useRefreshDriverAccess';

type Account = { user_id: string; label: string; blocked: string | null };
export function LegacyDriverAccountsDialog({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const refresh = useRefreshDriverAccess();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const query = useQuery({ queryKey: ['legacy_driver_accounts', tenantId], queryFn: () => driverAccessRequest<{ accounts: Account[] }>({ action: 'legacy_list', tenant_id: tenantId }), retry: false });
  const accounts = query.data?.accounts ?? [];
  const retire = async () => {
    if (!confirmed || query.isFetching || busy) return;
    setBusy(true); setResults([]);
    for (const account of accounts.filter(item => !item.blocked)) {
      if (!alive.current) break;
      try {
        await driverAccessRequest({ action: 'retire_legacy', tenant_id: tenantId, user_id: account.user_id });
        if (alive.current) setResults(previous => [...previous, `${account.label}: conta excluída.`]);
      } catch (error) {
        if (alive.current) setResults(previous => [...previous, `${account.label}: ${error instanceof Error ? error.message : 'falha na exclusão.'}`]);
      }
    }
    await refresh();
    if (alive.current) { setBusy(false); setConfirmed(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-lg" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Excluir contas antigas dos motoristas</DialogTitle><DialogDescription>Os acessos antigos serão excluídos. Os cadastros e o histórico dos motoristas serão preservados. Depois, crie os novos acessos em cada cadastro.</DialogDescription></DialogHeader>
      {query.isPending && <p>Consultando contas...</p>}
      {query.isError && <div role="alert"><p className="text-destructive">{query.error.message}</p><Button onClick={() => void query.refetch()}>Tentar novamente</Button></div>}
      {!query.isPending && !query.isError && <>
        <p className="text-sm">{accounts.length} conta(s) antiga(s) restante(s).</p>
        <ul className="max-h-48 overflow-y-auto text-sm space-y-2">{accounts.map(account => <li key={account.user_id}>{account.label}{account.blocked && <p className="text-destructive">{account.blocked}</p>}</li>)}</ul>
        <label className="flex gap-2 text-sm"><Checkbox checked={confirmed} disabled={busy} onCheckedChange={value => setConfirmed(value === true)} />Confirmo a exclusão dos acessos antigos desta empresa. Os motoristas precisarão das novas credenciais para entrar.</label>
        <Button variant="destructive" disabled={busy || query.isFetching || !confirmed || !accounts.some(account => !account.blocked)} onClick={() => void retire()}>{busy ? 'Excluindo...' : 'Excluir todas as contas antigas disponíveis'}</Button>
      </>}
      <div role="status" className="max-h-40 overflow-y-auto text-sm space-y-1">{results.map((result, index) => <p key={index}>{result}</p>)}</div>
      <Button variant="outline" disabled={busy} onClick={onClose}>Fechar</Button>
    </DialogContent>
  </Dialog>;
}
