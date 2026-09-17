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
import { localDateInputValue } from '@/lib/utils/formatDate';

const formSchema = z.object({ account: z.string(), driver: z.string(), amount: z.string(), date: z.string(),
  description: z.string(), beneficiary: z.string(), reference: z.string(), reason: z.string(),
  nature: z.enum(['driver_advance', 'payment', 'receipt', 'refund', 'customer_advance', 'other']), direction: z.enum(['in', 'out']),
});
type Form = z.infer<typeof formSchema>;
const savedSchema = z.object({ form: formSchema, request: z.string().uuid().nullable() });
function initialForm(initialAccount = '', initialDriver?: {id:string;name:string}): Form {
  return { account: initialAccount, driver: initialDriver?.id ?? '', amount: '', date: localDateInputValue(), description: '',
    beneficiary: initialDriver?.name ?? '', reference: '', reason: '', nature: 'driver_advance', direction: 'out' };
}
function restore(key: string, initialAccount = '', initialDriver?: {id:string;name:string}) {
  const empty={form:initialForm(initialAccount,initialDriver),request:null};
  try { const raw=sessionStorage.getItem(key);if(raw===null)return {saved:empty,error:''};return {saved:savedSchema.parse(JSON.parse(raw)),error:''}; }
  catch { return {saved:empty,error:'Não foi possível recuperar o pedido original. Novos envios estão bloqueados; confira o histórico antes de recuperar o armazenamento.'}; }
}
export function MovementEntryDialog({ tenant, actor, onClose, onRecorded, initialAccount, initialDriver }: {
  tenant: string; actor: string; onClose: () => void; onRecorded: () => void; initialAccount?: string; initialDriver?: {id:string;name:string};
}) {
  const key = `finance-movement-draft:${tenant}:${actor}`;
  const [restored] = useState(() => restore(key, initialAccount,initialDriver));
  const [saved, setSaved] = useState(restored.saved);
  const sending=useRef(false);
  const [busy, setBusy] = useState(false), [recoveryError,setRecoveryError]=useState(restored.error), [restoredAccountAccepted,setRestoredAccountAccepted]=useState(false), [error, setError] = useState('');
  const [storageFailed, setStorageFailed] = useState(false);
  const accounts = useBankAccounts(), drivers = useDrivers(); const form = saved.form,accountMismatch=!!initialAccount&&!!form.account&&form.account!==initialAccount&&!restoredAccountAccepted;
  useEffect(() => { if(recoveryError)return;try { sessionStorage.setItem(key, JSON.stringify(saved)); setStorageFailed(false); } catch { setStorageFailed(true); } }, [key, saved,recoveryError]);
  const field = <K extends keyof Form>(name: K, value: Form[K]) => setSaved(old => ({ ...old, form: { ...old.form, [name]: value } }));
  const input = (name: 'amount' | 'date' | 'description' | 'beneficiary' | 'reference' | 'reason', label: string, type = 'text') =>
    <div><Label htmlFor={`movement-${name}`}>{label}</Label><Input id={`movement-${name}`} type={type} value={form[name]}
      onChange={event => field(name, event.target.value)} inputMode={name === 'amount' ? 'decimal' : undefined} required={name !== 'reference'} /></div>;
  async function submit() {
    if(sending.current||recoveryError||storageFailed||accountMismatch)return;
    const amount = parseFinanceAmount(form.amount);
    if (!amount || !form.account || !form.beneficiary.trim() || !form.description.trim() || form.reason.trim().length < 5 || form.date>localDateInputValue() || (form.nature === 'driver_advance' && !form.driver)) {
      setError('Informe conta, beneficiário, valor válido, descrição e motivo com pelo menos 5 caracteres. Para envio, selecione o motorista.'); return;
    }
    const request = saved.request ?? crypto.randomUUID(); const attempt = { form, request };
    try { sessionStorage.setItem(key, JSON.stringify(attempt)); } catch { setStorageFailed(true); return; }
    sending.current=true;setSaved(attempt); setBusy(true); setError('');
    const command: MovementCommand = { version: 1, tenant_id: tenant, request_id: request,
      bank_account_id: form.account, direction: form.nature === 'driver_advance' ? 'out' : form.direction,
      nature: form.nature, amount_cents: amount, occurred_on: form.date, description: form.description,
      beneficiary_name: form.beneficiary, reason: form.reason,
      ...(form.driver ? { driver_id: form.driver } : {}),
      ...(form.reference.trim() ? { bank_reference: form.reference.trim() } : {}),
    };
    try { await recordFinanceMovement(command); sessionStorage.removeItem(key); onRecorded(); }
    catch (cause) { setError(financeError(cause)); if (cause instanceof FinanceRejectedError&&!saved.request) setSaved(old => ({ ...old, request: null })); }
    finally { sending.current=false;setBusy(false); }
  }
  function discardRecovery(){try{sessionStorage.removeItem(key);setSaved({form:initialForm(initialAccount,initialDriver),request:null});setRecoveryError('');setRestoredAccountAccepted(false);setError('');setStorageFailed(false);}catch{setError('Não foi possível descartar a recuperação incompatível. Reabra o formulário e tente novamente.');}}
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Registrar movimentação realizada</DialogTitle>
        <DialogDescription>Informe o dinheiro já enviado ou recebido. A confirmação pelo extrato será feita na conciliação.</DialogDescription></DialogHeader>
      {accountMismatch&&<div role="alert" className="space-y-2"><p>O rascunho recuperado pertence a outra conta. Escolha explicitamente qual conta deve receber o lançamento antes de continuar.</p><div className="flex gap-2"><Button type="button" variant="outline" onClick={()=>{field('account',initialAccount!);setRestoredAccountAccepted(false);}}>Usar conta atualmente selecionada</Button><Button type="button" variant="outline" onClick={()=>setRestoredAccountAccepted(true)}>Manter conta do rascunho</Button></div></div>}
      {initialDriver && form.driver !== initialDriver.id && <p role="status">Há um rascunho recuperado para outro contexto. Confira o motorista e os dados originais antes de registrar; a seleção do acerto não substituiu esse pedido.</p>}
      <form onSubmit={event => { event.preventDefault(); if (!busy) void submit(); }} className="space-y-4">
        <fieldset disabled={busy || !!saved.request || !!recoveryError} className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="movement-nature">Natureza</Label><select id="movement-nature" className="h-10 w-full rounded-md border bg-background px-3" value={form.nature} onChange={e => {
            const nature = e.target.value as Form['nature'];
            setSaved(old => ({ ...old, form: { ...old.form, nature, direction: ['receipt', 'customer_advance'].includes(nature) ? 'in' : 'out' } }));
          }}>
            <option value="driver_advance">Envio ao motorista</option><option value="payment">Pagamento</option><option value="receipt">Recebimento</option>
            <option value="refund">Devolução</option><option value="customer_advance">Adiantamento de cliente</option><option value="other">Outra movimentação</option>
          </select></div>
          <div><Label htmlFor="movement-account">Conta</Label><select id="movement-account" required className="h-10 w-full rounded-md border bg-background px-3" value={form.account} onChange={e => field('account', e.target.value)}>
            <option value="">Selecione a conta</option>{accounts.data?.filter(account=>account.active).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select></div>
          {(form.nature === 'driver_advance'||form.direction==='in') ? <div className="sm:col-span-2"><Label htmlFor="movement-driver">Motorista {form.nature==='driver_advance'?'beneficiário':'relacionado (para devoluções)'}</Label><select id="movement-driver" required={form.nature==='driver_advance'} className="h-10 w-full rounded-md border bg-background px-3" value={form.driver} onChange={e => {
            const driver = drivers.data?.find(row => row.id === e.target.value);
            setSaved(old => ({ ...old, form: { ...old.form, driver: e.target.value, beneficiary: driver?.name ?? '' } }));
          }}><option value="">Selecione o motorista</option>{drivers.data?.map(driver => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></div>
            : <div><Label htmlFor="movement-direction">Direção</Label><select id="movement-direction" className="h-10 w-full rounded-md border bg-background px-3" value={form.direction} onChange={e => field('direction', e.target.value as Form['direction'])}><option value="out">Saída</option><option value="in">Entrada</option></select></div>}
          {input('beneficiary', 'Beneficiário / pagador')}{input('amount', 'Valor (R$)')}<div><Label htmlFor="movement-date">Data da movimentação</Label><Input id="movement-date" type="date" max={localDateInputValue()} value={form.date} onChange={event=>field('date',event.target.value)} required/></div>
          {input('description', 'Motivo da movimentação')}{input('reference', 'Referência bancária / identificador do PIX')}
          {input('reason', 'Observação da conferência')}
        </fieldset>
        {(accounts.error || drivers.error) && <p role="alert">Falha ao carregar contas ou motoristas. Reabra o formulário para atualizar os cadastros.</p>}
        {storageFailed && <p role="alert">Não foi possível preservar o pedido neste navegador. Habilite o armazenamento para registrar com recuperação segura.</p>}
        {recoveryError&&<><p role="alert">{recoveryError}</p><Button type="button" variant="outline" disabled={busy} onClick={discardRecovery}>Descartar recuperação incompatível</Button></>}
        {saved.request && <p role="status" className="text-sm text-muted-foreground">Pedido preservado. Reenviar usa a mesma referência e não cria uma segunda movimentação.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Fechar e manter rascunho</Button>
          <Button type="submit" disabled={busy || storageFailed || !!recoveryError||accountMismatch}>{busy ? 'Confirmando…' : saved.request ? 'Reenviar mesmo pedido' : 'Registrar movimentação'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
