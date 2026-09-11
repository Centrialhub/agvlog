import {QuarantineFileUpload} from './QuarantineFileUpload';
import {uploadArtifactStatus} from '@/lib/financial/uploadArtifactContract';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useBankAccounts} from '@/hooks/useFinancialPayments';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {inspectStatementLayout,prepareStatementImport,statementImportWorkflow} from '@/lib/financial/statementImportClient';
import {statementImportStore} from '@/lib/financial/statementImportStore';
import type {PendingStatement,StatementVerificationResult} from '@/lib/financial/statementImportContract';
import {statementImportErrorMessage} from '@/lib/financial/statementImportContract';
import type {StatementMapping} from '../../../supabase/functions/_shared/finance-statement-reader';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
const initialMap:StatementMapping={header_row:0,sheet_index:0,delimiter:';',number_format:'br',date_format:'dmy',date_column:0,description_column:1,amount_column:2};
const stageLabel={upload:'Preservar original',intake:'Registrar linhas',verify:'Conferir dados preservados no servidor',rejected:'Pedido rejeitado'};
export function StatementImportDialog({tenant,actor,onClose,onImported,initial}:{tenant:string;actor:string;onClose:()=>void;onImported:(result:StatementVerificationResult)=>void;initial?:{account:string;start:string;end:string}}){
  const active=useRef(true),version=useRef(0),accounts=useBankAccounts();
  const [workflow]=useState(()=>statementImportWorkflow(()=>{if(!active.current)throw new Error('A sessão de importação mudou. Retome o pedido no contexto original.');}));
  const [pending,setPending]=useState<PendingStatement|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [file,setFile]=useState<File|null>(null),[layout,setLayout]=useState<Awaited<ReturnType<typeof inspectStatementLayout>>|null>(null),[mapping,setMapping]=useState(initialMap);
  const [account,setAccount]=useState(initial?.account||''),[start,setStart]=useState(initial?.start||''),[end,setEnd]=useState(initial?.end||''),[reason,setReason]=useState('Conferência do extrato bancário');
  const [prepared,setPrepared]=useState<Awaited<ReturnType<typeof prepareStatementImport>>|null>(null);
  const loadPending=useCallback(async()=>{const result=await statementImportStore.load(tenant,actor);if(active.current){setPending(result);setLoaded(true);}return result;},[tenant,actor]);
  useEffect(()=>{active.current=true;void loadPending().catch(()=>{if(active.current)setError('Não foi possível abrir os pedidos preservados. Tente novamente antes de importar.');});
    return()=>{active.current=false;};
  },[loadPending]);
  async function readFile(next:File,nextMap=mapping){
    const current=++version.current;setBusy(true);setError('');setPrepared(null);setLayout(null);setFile(next);
    if(/\.(pdf|jpe?g|png)$/i.test(next.name)){setBusy(false);return;}
    try{const result=await inspectStatementLayout(next,nextMap.delimiter||';',nextMap.sheet_index||0);
      if(active.current&&current===version.current){setLayout(result);setMapping(nextMap);
        if(result.nativeOfx){const dates=[result.nativeOfx.period.start.date,result.nativeOfx.period.end.date,...result.nativeOfx.rows.map(row=>row.posted_on)].sort();setStart(dates[0]);setEnd(dates[dates.length-1]);}
        if('preview_error' in result&&typeof result.preview_error==='string')setError(result.preview_error);}}
    catch(cause){if(active.current&&current===version.current)setError(statementImportErrorMessage(cause));}
    finally{if(active.current&&current===version.current)setBusy(false);}
  }
  function updateMapping(next:StatementMapping){setPrepared(null);setMapping(next);}
  async function prepare(){
    if(!file||!account||!start||!end||start>end){setError('Selecione arquivo, conta e um período válido.');return;}
    setBusy(true);setError('');
    try{const result=await prepareStatementImport(file,{tenant,actor,account,start,end,reason},mapping);if(active.current)setPrepared(result);}
    catch(cause){if(active.current)setError(statementImportErrorMessage(cause));}
    finally{if(active.current)setBusy(false);}
  }
  async function run(){
    setBusy(true);setError('');
    try{const result=await workflow.run(tenant,actor,pending?undefined:prepared?.pending,file||undefined);if(active.current)onImported(result);}
    catch(cause){if(active.current){setError(statementImportErrorMessage(cause));
      try{const saved=await loadPending();if(saved)setPrepared(null);}catch{setLoaded(false);}}}
    finally{if(active.current)setBusy(false);}
  }
  const column=(key:'date_column'|'description_column'|'amount_column'|'credit_column'|'debit_column'|'bank_id_column'|'document_column'|'counterparty_document_column'|'counterparty_name_column'|'balance_column',label:string,required=false)=>
    <label className="text-sm">{label}<select aria-label={label} className="block h-10 w-full rounded border bg-background" value={mapping[key]??''}
      onChange={e=>updateMapping({...mapping,[key]:e.target.value===''?undefined:Number(e.target.value)})}>
      {!required&&<option value="">Não disponível</option>}{(layout?.matrix[mapping.header_row]||[]).map((header,index)=><option key={index} value={index}>{index+1}. {String(header??'Sem título')}</option>)}</select></label>;
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl" onInteractOutside={e=>{if(busy)e.preventDefault();}}>
    <DialogHeader><DialogTitle>Importar e conferir extrato</DialogTitle><DialogDescription>O original fica privado em quarentena. OFX e CSV são conferidos por uma cópia de dados validada; conta, cobertura e saldos exigem conferência separada.</DialogDescription></DialogHeader>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {!loaded&&<Button disabled={busy} onClick={()=>void loadPending().catch(()=>setError('Recuperação indisponível. Nenhuma importação foi enviada.'))}>Abrir recuperação</Button>}
    {loaded&&pending?<div className="space-y-3"><p className="font-medium">{pending.file_name} · {pending.command.rows.length} registros</p><p>Próxima etapa: {stageLabel[pending.phase]}</p>
      {pending.phase==='upload'&&<label className="text-sm">Mesmo arquivo original, se necessário<Input type="file" accept=".csv,.xls,.xlsx,.ofx" disabled={busy} onChange={e=>setFile(e.target.files?.[0]||null)}/></label>}
      {pending.artifact&&<p role="status" className="rounded border p-3 text-sm">{uploadArtifactStatus(pending.artifact)}</p>}<p className="text-sm">O pedido e suas identificações foram preservados. Retomar não cria uma segunda importação.</p>
      <div className="flex gap-2">{pending.phase!=='rejected'&&<Button disabled={busy} onClick={()=>void run()}>Retomar importação</Button>}
        {['upload','rejected'].includes(pending.phase)&&!pending.uncertain&&<Button variant="outline" disabled={busy} onClick={()=>{
          setBusy(true);void workflow.abandon(tenant,actor).then(()=>loadPending()).catch(cause=>setError(cause instanceof Error?cause.message:'Pedido não descartado.')).finally(()=>setBusy(false));
        }}>Descartar pedido {pending.phase==='rejected'?'rejeitado':'não enviado'}</Button>}</div>
    </div>:loaded&&<div className="space-y-4"><fieldset disabled={busy} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Conta bancária<select aria-label="Conta do extrato" className="block h-10 w-full rounded border bg-background" value={account} onChange={e=>{setAccount(e.target.value);setPrepared(null);}}>
        <option value="">Selecionar</option>{(accounts.data||[]).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="text-sm">Início do período<Input aria-label="Início do período" type="date" value={start} onChange={e=>{setStart(e.target.value);setPrepared(null);}}/></label>
        <label className="text-sm">Fim do período<Input aria-label="Fim do período" type="date" value={end} onChange={e=>{setEnd(e.target.value);setPrepared(null);}}/></label></div>
      <label className="block text-sm">Arquivo original<Input aria-label="Arquivo original" type="file" accept=".csv,.xls,.xlsx,.ofx,.pdf,.jpg,.jpeg,.png" onChange={e=>{const selected=e.target.files?.[0];if(selected)void readFile(selected);}}/></label>
      {file&&<QuarantineFileUpload key={`${tenant}:${actor}:${account}:${version.current}`} tenant={tenant} actor={actor} account={account} file={file}/>}
      {!layout?.nativeOfx&&<label className="text-sm">Separador CSV<select className="block h-10 rounded border bg-background" value={mapping.delimiter} onChange={e=>{const next={...mapping,delimiter:e.target.value as StatementMapping['delimiter']};if(file)void readFile(file,next);else updateMapping(next);}}>
        <option value=";">Ponto e vírgula</option><option value=",">Vírgula</option><option value={'\t'}>Tabulação</option></select></label>}
      {layout?.nativeOfx&&<div className="rounded border p-3 text-sm"><p>Dados lidos diretamente do OFX: banco {layout.nativeOfx.account.bank_id}, agência {layout.nativeOfx.account.branch_id||'não informada'}, conta {layout.nativeOfx.account.account_id}.</p>
        <p>Confira se correspondem à conta selecionada. A leitura do arquivo ainda não confirma a conta nem a cobertura completa do período.</p></div>}
      {layout&&!layout.nativeOfx&&<><div className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm">Aba<select className="block h-10 w-full rounded border bg-background" value={mapping.sheet_index||0} onChange={e=>{if(file)void readFile(file,{...mapping,sheet_index:Number(e.target.value)});}}>
          {layout.sheetNames.map((name,index)=><option key={index} value={index}>{name}</option>)}</select></label>
        <label className="text-sm">Linha do cabeçalho<Input type="number" min={1} max={20} value={mapping.header_row+1} onChange={e=>updateMapping({...mapping,header_row:Number(e.target.value)-1})}/></label>
        <label className="text-sm">Formato de valores<select className="block h-10 w-full rounded border bg-background" value={mapping.number_format} onChange={e=>updateMapping({...mapping,number_format:e.target.value as StatementMapping['number_format']})}>
          <option value="br">1.234,56</option><option value="decimal">1234.56</option></select></label>
        <label className="text-sm">Formato de datas<select className="block h-10 w-full rounded border bg-background" value={mapping.date_format} onChange={e=>updateMapping({...mapping,date_format:e.target.value as StatementMapping['date_format']})}>
          <option value="dmy">DD/MM/AAAA</option><option value="ymd">AAAA-MM-DD</option><option value="excel">Data numérica Excel</option></select></label></div>
        <div className="grid gap-3 sm:grid-cols-3">{column('date_column','Coluna de data',true)}{column('description_column','Coluna de descrição',true)}{column('amount_column','Valor com sinal')}
          {column('credit_column','Crédito separado')}{column('debit_column','Débito separado')}{column('balance_column','Coluna de saldo')}
          {column('bank_id_column','Identificador único do banco')}{column('document_column','Documento / referência')}{column('counterparty_document_column','Documento da contraparte')}{column('counterparty_name_column','Nome da contraparte')}</div>
        {mapping.balance_column!==undefined&&<div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Significado do saldo<select className="block h-10 rounded border bg-background" value={mapping.balance_basis||''} onChange={e=>updateMapping({...mapping,balance_basis:(e.target.value||undefined) as StatementMapping['balance_basis']})}>
            <option value="">Não confirmado</option><option value="after_transaction">Saldo após cada transação</option><option value="before_transaction">Saldo antes de cada transação</option></select></label>
          <label className="text-sm">Ordem das transações no arquivo<select className="block h-10 rounded border bg-background" value={mapping.row_order||''} onChange={e=>updateMapping({...mapping,row_order:(e.target.value||undefined) as StatementMapping['row_order']})}>
            <option value="">Não confirmada</option><option value="chronological">Da mais antiga para a mais recente</option><option value="reverse_chronological">Da mais recente para a mais antiga</option></select></label>
          <p className="text-xs text-muted-foreground">Confirme pelo formato do banco, inclusive a ordem no mesmo dia. Saldos diários repetidos em várias linhas não equivalem ao saldo de cada transação.</p></div>}
        <p className="text-xs text-muted-foreground">Use valor com sinal ou crédito/débito separados. Preencha identificador único apenas quando o banco fornecer essa identificação; descrição ou valor não servem como identificador.</p>
      </>}
      <label className="block text-sm">Observação da conferência<Input value={reason} onChange={e=>{setReason(e.target.value);setPrepared(null);}}/></label>
      <Button variant="outline" disabled={!layout||!file} onClick={()=>void prepare()}>Preparar prévia</Button>
    </fieldset>
    {prepared&&<div className="space-y-3 rounded border p-4"><p>{prepared.pending.command.rows.length} registros · Entradas {formatFinanceCents(prepared.totals.inflow_cents)} · Saídas {formatFinanceCents(prepared.totals.outflow_cents)}</p>
      <div className="max-h-52 overflow-auto text-sm">{prepared.pending.command.rows.slice(0,20).map((row,index)=><p key={index}>{row.posted_on} · {row.description} · {formatFinanceCents(row.amount_cents)}</p>)}</div>
      <p className="text-xs">A prévia mostra até 20 registros. O servidor conferirá todas as linhas e preservará as ambiguidades de identificação.</p>
      <Button disabled={busy} onClick={()=>void run()}>Importar e conferir dados</Button></div>}
    </div>}
    {busy&&<p role="status">Processando a etapa atual…</p>}
    <Button variant="ghost" disabled={busy} onClick={onClose}>Fechar</Button>
  </DialogContent></Dialog>;
}
