import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useBankAccounts } from '@/hooks/useFinancialPayments';
import { useDrivers } from '@/hooks/useDrivers';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FinanceRejectedError, recordFinanceMovement } from '@/lib/financial/ledgerClient';
import { financeError, parseFinanceAmount, type MovementCommand } from '@/lib/financial/ledgerContract';

const formSchema = z.object({ account: z.string(), driver: z.string(), amount: z.string(), date: z.string(),
  description: z.string(), beneficiary: z.string(), reference: z.string(), reason: z.string(),
  nature: z.enum(['driver_advance', 'payment', 'receipt', 'refund', 'customer_advance', 'other']), direction: z.enum(['in', 'out']),
});
type Form = z.infer<typeof formSchema>;
const savedSchema = z.object({ form: formSchema, request: z.string().uuid().nullable() });
function initialForm(initialAccount = ''): Form {
  const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return { account: initialAccount, driver: '', amount: '', date: date.toISOString().slice(0, 10), description: '',
    beneficiary: '', reference: '', reason: '', nature: 'driver_advance', direction: 'out' };
}
function restore(key: string, initialAccount = '') {
  const empty={form:initialForm(initialAccount),request:null};
  try { const raw=sessionStorage.getItem(key);if(raw===null)return {saved:empty,error:''};return {saved:savedSchema.parse(JSON.parse(raw)),error:''}; }
  catch { return {saved:empty,error:'Não foi possível recuperar o pedido original. Novos envios estão bloqueados; confira o histórico antes de recuperar o armazenamento.'}; }
}
export function MovementEntryDialog({ tenant, actor, onClose, onRecorded, initialAccount }: {
  tenant: string; actor: string; onClose: () => void; onRecorded: () => void; initialAccount?: string;
}) {
  const key = `finance-movement-draft:${tenant}:${actor}`;
  const [restored] = useState(() => restore(key, initialAccount));
  const [saved, setSaved] = useState(restored.saved);
  const sending=useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [storageFailed, setStorageFailed] = useState(false);
  const accounts = useBankAccounts(), drivers = useDrivers(); const form = saved.form;
  useEffect(() => { if(restored.error)return;try { sessionStorage.setItem(key, JSON.stringify(saved)); setStorageFailed(false); } catch { setStorageFailed(true); } }, [key, saved,restored.error]);
  const field = <K extends keyof Form>(name: K, value: Form[K]) => setSaved(old => ({ ...old, form: { ...old.form, [name]: value } }));
  const input = (name: 'amount' | 'date' | 'description' | 'beneficiary' | 'reference' | 'reason', label: string, type = 'text') =>
    <div><Label htmlFor={`movement-${name}`}>{label}</Label><Input id={`movement-${name}`} type={type} value={form[name]}
      onChange={event => field(name, event.target.value)} inputMode={name === 'amount' ? 'decimal' : undefined} required={name !== 'reference'} /></div>;
  async function submit() {
    if(sending.current||restored.error||storageFailed)return;
    const amount = parseFinanceAmount(form.amount);
    if (!amount || !form.account || !form.beneficiary.trim() || !form.description.trim() || form.reason.trim().length < 5 || (form.nature === 'driver_advance' && !form.driver)) {
      setError('Informe conta, beneficiário, valor válido, descrição e motivo com pelo menos 5 caracteres. Para envio, selecione o motorista.'); return;
    }
    const request = saved.request ?? crypto.randomUUID(); const attempt = { form, request };
    try { sessionStorage.setItem(key, JSON.stringify(attempt)); } catch { setStorageFailed(true); return; }
    sending.current=true;setSaved(attempt); setBusy(true); setError('');
    const command: MovementCommand = { version: 1, tenant_id: tenant, request_id: request,
      bank_account_id: form.account, direction: form.nature === 'driver_advance' ? 'out' : form.direction,
      nature: form.nature, amount_cents: amount, occurred_on: form.date, description: form.description,
      beneficiary_name: form.beneficiary, reason: form.reason,
      ...(form.nature === 'driver_advance' ? { driver_id: form.driver } : {}),
      ...(form.reference.trim() ? { bank_reference: form.reference.trim() } : {}),
    };
    try { await recordFinanceMovement(command); sessionStorage.removeItem(key); onRecorded(); }
    catch (cause) { setError(financeError(cause)); if (cause instanceof FinanceRejectedError&&!saved.request) setSaved(old => ({ ...old, request: null })); }
    finally { sending.current=false;setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Registrar movimentação realizada</DialogTitle>
        <DialogDescription>Informe o dinheiro já enviado ou recebido. A confirmação pelo extrato será feita na conciliação.</DialogDescription></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); if (!busy) void submit(); }} className="space-y-4">
        <fieldset disabled={busy || !!saved.request || !!restored.error} className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="movement-nature">Natureza</Label><select id="movement-nature" className="h-10 w-full rounded-md border bg-background px-3" value={form.nature} onChange={e => {
            const nature = e.target.value as Form['nature'];
            setSaved(old => ({ ...old, form: { ...old.form, nature, direction: ['receipt', 'customer_advance'].includes(nature) ? 'in' : 'out' } }));
          }}>
            <option value="driver_advance">Envio ao motorista</option><option value="payment">Pagamento</option><option value="receipt">Recebimento</option>
            <option value="refund">Devolução</option><option value="customer_advance">Adiantamento de cliente</option><option value="other">Outra movimentação</option>
          </select></div>
          <div><Label htmlFor="movement-account">Conta</Label><select id="movement-account" required className="h-10 w-full rounded-md border bg-background px-3" value={form.account} onChange={e => field('account', e.target.value)}>
            <option value="">Selecione a conta</option>{accounts.data?.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select></div>
          {form.nature === 'driver_advance' ? <div className="sm:col-span-2"><Label htmlFor="movement-driver">Motorista beneficiário</Label><select id="movement-driver" required className="h-10 w-full rounded-md border bg-background px-3" value={form.driver} onChange={e => {
            const driver = drivers.data?.find(row => row.id === e.target.value);
            setSaved(old => ({ ...old, form: { ...old.form, driver: e.target.value, beneficiary: driver?.name ?? '' } }));
          }}><option value="">Selecione o motorista</option>{drivers.data?.map(driver => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></div>
            : <div><Label htmlFor="movement-direction">Direção</Label><select id="movement-direction" className="h-10 w-full rounded-md border bg-background px-3" value={form.direction} onChange={e => field('direction', e.target.value as Form['direction'])}><option value="out">Saída</option><option value="in">Entrada</option></select></div>}
          {input('beneficiary', 'Beneficiário / pagador')}{input('amount', 'Valor (R$)')}{input('date', 'Data da movimentação', 'date')}
          {input('description', 'Motivo da movimentação')}{input('reference', 'Referência bancária / identificador do PIX')}
          {input('reason', 'Observação da conferência')}
        </fieldset>
        {(accounts.error || drivers.error) && <p role="alert">Falha ao carregar contas ou motoristas. Reabra o formulário para atualizar os cadastros.</p>}
        {storageFailed && <p role="alert">Não foi possível preservar o pedido neste navegador. Habilite o armazenamento para registrar com recuperação segura.</p>}
        {restored.error&&<p role="alert">{restored.error}</p>}
        {saved.request && <p role="status" className="text-sm text-muted-foreground">Pedido preservado. Reenviar usa a mesma referência e não cria uma segunda movimentação.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Fechar e manter rascunho</Button>
          <Button type="submit" disabled={busy || storageFailed || !!restored.error}>{busy ? 'Confirmando…' : saved.request ? 'Reenviar mesmo pedido' : 'Registrar movimentação'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
