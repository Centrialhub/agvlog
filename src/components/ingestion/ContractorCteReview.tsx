import { useEffect, useRef, useState } from 'react';
import { AlertCircle, FileUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { readBlobBytes } from '@/lib/uploadPolicy';
import { contractorCteSchema, cteIdentityFromKey, describeContractorCteFile, parseContractorCteXml,
  type ContractorCte } from '@/lib/ingestion/contractorCte';

type Props = {
  scopeKey: string;
  onConfirm: (file: File, document: ContractorCte) => Promise<void>;
};
type Draft = Omit<Partial<ContractorCte>, 'issuer_address'> & { issuer_address: ContractorCte['issuer_address'] };
const blankAddress = () => ({ street: '', number: '', neighborhood: '', city: '', city_code: '', state: '', zip: '' });
const fields = [
  ['issuer_name', 'Razão social da transportadora contratante'], ['issuer_ie', 'Inscrição estadual da contratante'],
  ['issuer_state', 'UF da contratante'], ['origin_city_code', 'Código IBGE de início da prestação'],
  ['destination_city_code', 'Código IBGE de término da prestação'],
] as const;
const addressFields = [
  ['street', 'Logradouro da contratante'], ['number', 'Número do endereço'], ['neighborhood', 'Bairro'],
  ['city', 'Município da contratante'], ['city_code', 'Código IBGE do município da contratante'], ['zip', 'CEP'],
] as const;
const errorText = (error: unknown) => error instanceof Error
  ? ('issues' in error && Array.isArray(error.issues) ? error.issues.map((issue: { message: string }) => issue.message).join(' ') : error.message)
  : 'Não foi possível importar o documento. Tente novamente.';

/** Remount on actor/tenant changes: a previous document must never cross company boundaries. */
export default function ContractorCteReview({ scopeKey, ...props }: Props) {
  return <Review key={scopeKey} {...props} />;
}

function Review({ onConfirm }: Omit<Props, 'scopeKey'>) {
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<Draft>({ issuer_address: blankAddress() });
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'reading' | 'saving'>('idle');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    const lifecycle = generation;
    alive.current = true;
    return () => { alive.current = false; lifecycle.current++; };
  }, []);
  const busy = phase !== 'idle';
  const pdf = draft.source_format === 'pdf';

  async function selectFile(candidate: File) {
    if (busy) return;
    const run = ++generation.current;
    setPhase('reading'); setFile(null); setDraft({ issuer_address: blankAddress() }); setConfirmed(false); setSaved(false); setError('');
    try {
      const description = await describeContractorCteFile(candidate);
      const document = description.format === 'xml'
        ? parseContractorCteXml(new TextDecoder('utf-8', { fatal: true }).decode(await readBlobBytes(candidate)))
        : { source_format: 'pdf' as const, issuer_address: blankAddress(), referenced_nfe_keys: [],
          authorization_protocol: null, authorization_declared: false };
      if (!alive.current || run !== generation.current) return;
      setFile(candidate); setDraft(document);
    } catch (cause) { if (alive.current && run === generation.current) setError(errorText(cause)); }
    finally { if (alive.current && run === generation.current) setPhase('idle'); }
  }

  function setKey(value: string) {
    const key = value.replace(/[\s.-]/g, '');
    let identity = { access_key: key, issuer_cnpj: '', number: '', series: '' };
    try { identity = cteIdentityFromKey(key); } catch { /* Show schema error on confirmation. */ }
    setDraft(previous => ({ ...previous, ...identity })); setConfirmed(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy || saved) return;
    if (pdf && !confirmed) { setError('Confira os dados com o PDF/DACTE antes de importar.'); return; }
    const run = generation.current;
    setError(''); setPhase('saving');
    try {
      const document = contractorCteSchema.parse({ ...draft,
        issuer_address: { ...draft.issuer_address, state: draft.issuer_state ?? '' } });
      await onConfirm(file, document);
      if (alive.current && generation.current === run) setSaved(true);
    } catch (cause) { if (alive.current && generation.current === run) setError(errorText(cause)); }
    finally { if (alive.current && generation.current === run) setPhase('idle'); }
  }

  return <section className="space-y-4" aria-label="Importação de CT-e da contratante">
    <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
      <h3 className="font-semibold">CT-e da transportadora contratante</h3>
      <p className="text-sm text-muted-foreground">Importe XML ou PDF/DACTE para conferir e cadastrar o documento de origem da subcontratação. Até 10 MB por arquivo.</p>
      <input ref={input} type="file" accept=".xml,.pdf,application/xml,text/xml,application/pdf" className="sr-only"
        aria-label="Selecionar XML ou PDF/DACTE do CT-e" disabled={busy}
        onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void selectFile(selected); }} />
      <Button type="button" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
        {phase === 'reading' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}Selecionar CT-e
      </Button>
      {file && <p className="text-sm break-all">{file.name}</p>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive flex items-start gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{error}</p>}
    {saved ? <p role="status">CT-e de origem importado com sucesso.</p> : file && <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">{pdf
        ? 'O PDF/DACTE será preservado como anexo. Informe e confira os dados nele apresentados; a chave preenche emitente, número e série.'
        : 'Dados lidos do XML. O protocolo informado no arquivo não substitui a verificação da situação atual na SEFAZ.'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2 space-y-1"><Label htmlFor="contractor-cte-key">Chave de acesso do CT-e</Label>
          <Input id="contractor-cte-key" value={draft.access_key ?? ''} onChange={event => setKey(event.target.value)} readOnly={!pdf} disabled={busy} maxLength={60} /></div>
        {([['number', 'Número do CT-e'], ['series', 'Série'], ['issuer_cnpj', 'CNPJ da contratante']] as const).map(([key, label]) =>
          <div key={key} className="space-y-1"><Label htmlFor={`contractor-${key}`}>{label}</Label><Input id={`contractor-${key}`} value={draft[key] ?? ''} readOnly /></div>)}
        <div className="space-y-1"><Label htmlFor="contractor-issue-date">Data de emissão</Label><Input id="contractor-issue-date" type="date" value={draft.issue_date ?? ''}
          onChange={event => { setDraft(previous => ({ ...previous, issue_date: event.target.value })); setConfirmed(false); }} readOnly={!pdf} disabled={busy} /></div>
        <div className="space-y-1"><Label htmlFor="contractor-environment">Ambiente do documento</Label>
          <select id="contractor-environment" value={draft.environment ?? ''} disabled={!pdf || busy} className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            onChange={event => { setDraft(previous => ({ ...previous, environment: event.target.value as ContractorCte['environment'] })); setConfirmed(false); }}>
            <option value="">Selecione</option><option value="production">Produção</option><option value="homologation">Homologação</option>
          </select></div>
        {fields.map(([key, label]) => <div key={key} className="space-y-1"><Label htmlFor={`contractor-${key}`}>{label}</Label>
          <Input id={`contractor-${key}`} value={draft[key] ?? ''} readOnly={!pdf} disabled={busy}
            onChange={event => { setDraft(previous => ({ ...previous, [key]: key === 'issuer_state' ? event.target.value.toUpperCase() : event.target.value })); setConfirmed(false); }} /></div>)}
        {pdf && addressFields.map(([key, label]) => <div key={key} className="space-y-1"><Label htmlFor={`contractor-address-${key}`}>{label}</Label>
          <Input id={`contractor-address-${key}`} value={draft.issuer_address[key]} disabled={busy}
            onChange={event => { setDraft(previous => ({ ...previous, issuer_address: { ...previous.issuer_address, [key]: event.target.value } })); setConfirmed(false); }} /></div>)}
      </div>
      {pdf && <div className="flex items-center gap-2"><Checkbox id="contractor-cte-reviewed" checked={confirmed} disabled={busy}
        onCheckedChange={value => setConfirmed(value === true)} /><Label htmlFor="contractor-cte-reviewed">Conferi os dados com o PDF/DACTE original.</Label></div>}
      <Button type="submit" disabled={busy || (pdf && !confirmed)}>{phase === 'saving' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Importar CT-e de origem</Button>
    </form>}
  </section>;
}
