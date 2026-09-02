import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Download, FileCheck2, FileSignature,
  Loader2, RefreshCw, Send, ShieldCheck, Truck, User, XCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Load } from '@/hooks/useLoads';
import { useAuthorizedCteList } from '@/hooks/useAuthorizedCteList';
import { useEmitters, useHubCredentials } from '@/hooks/useEmitters';
import { useVehicles } from '@/hooks/useVehicles';
import { useInsuranceProfile } from '@/hooks/useInsuranceProfile';
import {
  downloadMdfeFile, useCloseMdfe, useIssueMdfe, useLoadMdfe, useSyncMdfe,
} from '@/hooks/useMdfe';
import { buildMdfePayload, type BuildMdfePayloadInput } from '@/lib/fiscal/mdfeBuilder';
import { deriveMdfePredominantProduct } from '@/lib/fiscal/mdfePredominantProduct';
import {
  canCloseMdfe, canDownloadMdfe, MDFE_STATUS_LABELS, normalizeMdfeStatus,
} from '@/lib/fiscal/mdfeStatus';
import { getErrorMessage } from '@/lib/errors';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FiscalEnvironmentSelect } from '@/components/fiscal/FiscalEnvironmentSelect';
import {
  selectScopedHubCredential, type HubEnvironment,
} from '../../../supabase/functions/_shared/fiscal-environment';
import type { EmitParams } from '@/lib/fiscal/hubFiscalClient';

interface Props {
  load: Load;
}

interface FormState {
  emitterId: string;
  environment: HubEnvironment;
  vehicleTara: string;
  rntrc: string;
  ciot: string;
  ciotResponsible: string;
  endorsements: string;
  originCity: string;
  originIbge: string;
  originUf: string;
  destinationCity: string;
  destinationIbge: string;
  destinationUf: string;
}

const EMPTY_FORM: FormState = {
  emitterId: '',
  environment: 'production',
  vehicleTara: '',
  rntrc: '',
  ciot: '',
  ciotResponsible: '',
  endorsements: '',
  originCity: '',
  originIbge: '',
  originUf: '',
  destinationCity: '',
  destinationIbge: '',
  destinationUf: '',
};

const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const stateFromIbge = (value: unknown) => digits(value).slice(0, 2);
const statusTone: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  processing: 'bg-info/10 text-info border-info/30',
  provider_unknown: 'bg-warning/10 text-warning border-warning/30',
  authorized: 'bg-success/10 text-success border-success/30',
  rejected: 'bg-destructive/10 text-destructive border-destructive/30',
  closing: 'bg-info/10 text-info border-info/30',
  closed: 'bg-success/10 text-success border-success/30',
  cancelled: 'bg-muted text-muted-foreground',
};

function readVehicleTara(tags: unknown): string {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return '';
  const record = tags as Record<string, unknown>;
  const value = record.tara_kg ?? record.taraKg ?? record.tara;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : '';
}

function returnedLoad(load: Load) {
  return Boolean(load.arrival_at) ||
    ['delivered', 'partial_delivery', 'returned', 'refused', 'failed'].includes(load.status);
}

export default function ManifestPanel({ load }: Props) {
  const toast = useSonnerToast();
  const initializedLoad = useRef<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [downloading, setDownloading] = useState<'pdf' | 'xml' | null>(null);

  const { data: manifest, isLoading: manifestLoading, refetch: refetchManifest } = useLoadMdfe(load.id);
  const { data: allCtes = [], isLoading: ctesLoading, refetch: refetchCtes } = useAuthorizedCteList(load.id);
  const { data: emitters = [], isLoading: emittersLoading } = useEmitters();
  const { data: vehicles = [], isLoading: vehiclesLoading } = useVehicles();
  const { data: insurance } = useInsuranceProfile();
  const { data: credentials = [] } = useHubCredentials(form.emitterId);
  const issueMdfe = useIssueMdfe();
  const syncMdfe = useSyncMdfe();
  const closeMdfe = useCloseMdfe();

  const { data: driver, isLoading: driverLoading } = useQuery({
    queryKey: ['mdfe', 'driver', load.tenant_id, load.driver_id],
    enabled: !!load.driver_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drivers')
        .select('id,name,cpf')
        .eq('tenant_id', load.tenant_id)
        .eq('id', load.driver_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const ctes = useMemo(
    () => allCtes.filter(document => document.load_ids.includes(load.id)),
    [allCtes, load.id],
  );
  const vehicle = useMemo(
    () => vehicles.find(candidate => candidate.id === load.vehicle_id) || null,
    [vehicles, load.vehicle_id],
  );
  const emitter = useMemo(
    () => emitters.find(candidate => candidate.id === form.emitterId) || null,
    [emitters, form.emitterId],
  );
  const predominantProduct = useMemo(() => deriveMdfePredominantProduct(ctes), [ctes]);
  const totals = useMemo(() => ({
    ctes: ctes.length,
    value: ctes.reduce((total, document) => total + Number(document.cargo_value || 0), 0),
    weight: ctes.reduce((total, document) => total + Number(document.cargo_weight || 0), 0),
  }), [ctes]);
  const credential = useMemo(
    () => selectScopedHubCredential(credentials, 'mdfe', form.environment),
    [credentials, form.environment],
  );

  useEffect(() => {
    if (
      initializedLoad.current === load.id || emittersLoading || vehiclesLoading ||
      ctesLoading || driverLoading || !emitters.length
    ) return;
    const defaultEmitter = emitters.find(candidate => candidate.active && candidate.is_default)
      || emitters.find(candidate => candidate.active)
      || null;
    const first = ctes[0];
    const selectedVehicle = vehicles.find(candidate => candidate.id === load.vehicle_id);
    const originIbge = digits(defaultEmitter?.city_code);
    const destinationIbge = digits(first?.recipient_city_ibge);
    setForm({
      emitterId: defaultEmitter?.id || '',
      environment: 'production',
      vehicleTara: readVehicleTara(selectedVehicle?.tags),
      rntrc: digits(defaultEmitter?.rntrc || defaultEmitter?.endereco?.rntrc),
      ciot: digits(load.ciot),
      ciotResponsible: digits(first?.taker_document),
      endorsements: [...new Set(ctes.flatMap(document => document.insurance_endorsements))].join(', '),
      originCity: defaultEmitter?.endereco?.municipio || load.origin || '',
      originIbge,
      originUf: stateFromIbge(originIbge),
      destinationCity: first?.recipient_city || load.destination || '',
      destinationIbge,
      destinationUf: first?.recipient_state || stateFromIbge(destinationIbge),
    });
    initializedLoad.current = load.id;
  }, [ctes, ctesLoading, driverLoading, emitters, emittersLoading, load, vehicles, vehiclesLoading]);

  const lifecycle = normalizeMdfeStatus(manifest?.status);
  const canRetry = !manifest || ['rejected', 'cancelled'].includes(lifecycle);
  const canIssueLoad = ['ready', 'loading', 'loaded', 'in_transit'].includes(load.status);
  const readyToIssue = Boolean(
    canRetry && canIssueLoad && ctes.length && driver?.name && digits(driver?.cpf).length === 11 &&
    vehicle?.plate && form.emitterId && credential && Number(form.vehicleTara) > 0 &&
    digits(form.rntrc).length === 8 && digits(form.ciot).length === 12 &&
    [11, 14].includes(digits(form.ciotResponsible).length) &&
    form.originIbge.length === 7 && form.destinationIbge.length === 7 &&
    predominantProduct && insurance?.name && insurance?.cnpj && insurance?.policy &&
    form.endorsements.trim(),
  );

  const update = (key: keyof FormState, value: string) =>
    setForm(previous => ({ ...previous, [key]: value }));

  const handleIssue = async () => {
    if (!emitter || !vehicle || !driver || !predominantProduct) {
      toast.error('A carga ainda não possui todos os dados fiscais necessários.');
      return;
    }
    const takers = Array.from(new Map(
      ctes.map(document => [digits(document.taker_document), {
        document: document.taker_document || '',
        name: document.taker_name || '',
        ie: document.taker_ie || 'ISENTO',
        address: {
          street: document.taker_street,
          number: document.taker_number,
          neighborhood: document.taker_neighborhood,
          city_ibge: document.taker_city_ibge,
          city_name: document.taker_city,
          state: document.taker_state,
          zip: document.taker_zip,
        },
      }]),
    ).values()).filter(taker => digits(taker.document));

    const input: BuildMdfePayloadInput = {
      emitter: {
        cnpj: emitter.cnpj,
        name: emitter.razao_social,
        environment: form.environment,
      },
      driver: { name: driver.name, cpf: driver.cpf || '' },
      vehicle: {
        plate: vehicle.plate,
        state: vehicle.uf || emitter.endereco?.uf || '',
        tara: Number(form.vehicleTara) || 0,
        rntrc: digits(form.rntrc),
        renavam: vehicle.renavam || '',
      },
      origin: {
        city_ibge: form.originIbge,
        city_name: form.originCity,
        state: form.originUf,
      },
      destination: {
        city_ibge: form.destinationIbge,
        city_name: form.destinationCity,
        state: form.destinationUf,
      },
      documents: ctes.map(document => ({
        key: document.access_key || '',
        type: 'cte',
        insuranceEndorsements: document.insurance_endorsements,
        destination: document.recipient_city_ibge ? {
          city_ibge: document.recipient_city_ibge,
          city_name: document.recipient_city || form.destinationCity,
          state: document.recipient_state || form.destinationUf,
        } : undefined,
      })),
      insurance: {
        providerName: insurance?.name || '',
        providerCnpj: insurance?.cnpj || '',
        policyNumber: insurance?.policy || '',
        endorsementNumbers: form.endorsements.split(/[,;\n]/).map(value => value.trim()).filter(Boolean),
      },
      valCarga: totals.value,
      pesoBruto: totals.weight,
      predominantProduct,
      cMone: '098',
      ciot: { number: form.ciot, responsibleDoc: form.ciotResponsible },
      takers,
    };

    const built = buildMdfePayload(input);
    if (!built.ok) {
      toast.error(`Revise antes de emitir: ${built.missing.join(', ')}`);
      return;
    }
    try {
      await issueMdfe.mutateAsync({
        loadId: load.id,
        emitterId: emitter.id,
        environment: form.environment,
        cteIds: ctes.map(document => document.id),
        snapshot: built.payload as EmitParams['body'],
      });
      toast.success('MDF-e enviado ao Hub Fiscal. Use Sincronizar até a autorização.');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Não foi possível emitir o MDF-e.'));
    }
  };

  const handleSync = async () => {
    if (!manifest) return;
    try {
      await syncMdfe.mutateAsync(manifest);
      await refetchManifest();
      toast.success('Situação do MDF-e sincronizada.');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao sincronizar o MDF-e.'));
    }
  };

  const handleClose = async () => {
    if (!manifest) return;
    try {
      await closeMdfe.mutateAsync(manifest);
      await refetchManifest();
      toast.success('Encerramento solicitado. Sincronize até o estado Encerrado.');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao solicitar o encerramento.'));
    }
  };

  const handleDownload = async (format: 'pdf' | 'xml') => {
    if (!manifest) return;
    setDownloading(format);
    try {
      await downloadMdfeFile(manifest, format);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, `Não foi possível baixar o ${format.toUpperCase()}.`));
    } finally {
      setDownloading(null);
    }
  };

  if (manifestLoading || ctesLoading || emittersLoading || vehiclesLoading || driverLoading) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Carregando ciclo MDF-e…</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSignature className="h-4 w-4" /> MDF-e da carga
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Um documento fiscal por carga, com emissão, arquivos e encerramento vinculados à viagem.
            </p>
          </div>
          {manifest && (
            <Badge variant="outline" className={statusTone[lifecycle]}>
              {MDFE_STATUS_LABELS[lifecycle]}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {manifest && !canRetry ? (
          <>
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 text-sm md:grid-cols-4">
              <div><span className="text-xs text-muted-foreground">Número</span><p className="font-semibold">{manifest.document_number || manifest.manifest_number}</p></div>
              <div><span className="text-xs text-muted-foreground">Série</span><p className="font-semibold">{manifest.document_series || '—'}</p></div>
              <div><span className="text-xs text-muted-foreground">Protocolo</span><p className="break-all font-mono text-xs">{manifest.authorization_protocol || 'Aguardando'}</p></div>
              <div><span className="text-xs text-muted-foreground">Ambiente</span><p className="font-semibold">{manifest.environment === 'production' ? 'Produção' : manifest.environment}</p></div>
            </div>
            {manifest.access_key && (
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Chave de acesso</p>
                <p className="break-all font-mono text-xs">{manifest.access_key}</p>
              </div>
            )}
            {manifest.status_message && lifecycle !== 'authorized' && lifecycle !== 'closed' && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>{manifest.status_message}</span>
              </div>
            )}
            {lifecycle === 'closed' && (
              <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>
                  Manifesto encerrado{manifest.closed_at ? ` em ${new Date(manifest.closed_at).toLocaleString('pt-BR')}` : ''}.
                  {manifest.closure_protocol ? ` Protocolo: ${manifest.closure_protocol}.` : ''}
                </span>
              </div>
            )}
            {lifecycle === 'provider_unknown' && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>O resultado precisa ser conciliado. Sincronize este documento; não gere outro MDF-e para a carga.</span>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {manifest.hub_document_id && (
                <Button variant="outline" onClick={handleSync} disabled={syncMdfe.isPending}>
                  <RefreshCw className={`mr-1 h-4 w-4 ${syncMdfe.isPending ? 'animate-spin' : ''}`} />
                  Sincronizar
                </Button>
              )}
              {canDownloadMdfe(lifecycle) && (
                <>
                  <Button variant="outline" onClick={() => handleDownload('xml')} disabled={downloading !== null}>
                    <Download className="mr-1 h-4 w-4" /> XML
                  </Button>
                  <Button variant="outline" onClick={() => handleDownload('pdf')} disabled={downloading !== null}>
                    {downloading === 'pdf' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-1 h-4 w-4" />}
                    PDF para motorista
                  </Button>
                </>
              )}
              {canCloseMdfe(lifecycle) && (
                <Button onClick={handleClose} disabled={!returnedLoad(load) || closeMdfe.isPending}>
                  <CheckCircle2 className="mr-1 h-4 w-4" />
                  {closeMdfe.isPending ? 'Solicitando…' : 'Encerrar manifesto'}
                </Button>
              )}
            </div>
            {canCloseMdfe(lifecycle) && !returnedLoad(load) && (
              <p className="text-right text-xs text-muted-foreground">
                O encerramento será liberado quando a carga registrar retorno/chegada ou um estado final de entrega.
              </p>
            )}
          </>
        ) : (
          <>
            {manifest && lifecycle === 'rejected' && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <span>{manifest.status_message || 'A emissão foi rejeitada. Corrija os campos abaixo e transmita novamente.'}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-5">
              <div><span className="text-xs text-muted-foreground">Carga</span><p className="font-semibold">{load.load_number}</p></div>
              <div><span className="text-xs text-muted-foreground">CT-es autorizados</span><p className="font-semibold">{totals.ctes}</p></div>
              <div><span className="text-xs text-muted-foreground">Peso</span><p className="font-semibold">{totals.weight.toLocaleString('pt-BR')} kg</p></div>
              <div><span className="text-xs text-muted-foreground">Valor da carga</span><p className="font-semibold">{totals.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p></div>
              <div><span className="text-xs text-muted-foreground">Produto predominante</span><p className="truncate font-semibold" title={predominantProduct || ''}>{predominantProduct || 'Não encontrado'}</p></div>
            </div>

            {!ctes.length && (
              <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Emita e autorize os CT-es desta carga antes do MDF-e.
              </div>
            )}

            {!canIssueLoad && (
              <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 text-warning" />
                O MDF-e só pode ser emitido quando a carga estiver pronta, carregando, carregada ou em trânsito.
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label>Emitente</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.emitterId} onChange={event => update('emitterId', event.target.value)}>
                  <option value="">Selecione</option>
                  {emitters.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.razao_social}</option>)}
                </select>
              </div>
              <FiscalEnvironmentSelect value={form.environment} onChange={value => update('environment', value)} />
              <div className="rounded-md border p-3">
                <p className="flex items-center gap-1 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Credencial MDF-e</p>
                <p className={`mt-1 text-sm font-medium ${credential ? 'text-success' : 'text-destructive'}`}>
                  {credential ? 'Configurada para este ambiente' : 'Não configurada'}
                </p>
              </div>
            </div>

            <Separator />
            <div>
              <h3 className="mb-3 text-sm font-semibold">Dados carregados da carga</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border p-3"><p className="flex items-center gap-1 text-xs text-muted-foreground"><User className="h-3.5 w-3.5" /> Motorista</p><p className="font-medium">{driver?.name || 'Não informado'}</p><p className="font-mono text-xs">{driver?.cpf || 'CPF ausente'}</p></div>
                <div className="rounded-md border p-3"><p className="flex items-center gap-1 text-xs text-muted-foreground"><Truck className="h-3.5 w-3.5" /> Veículo</p><p className="font-medium">{vehicle?.plate || 'Não informado'}</p><p className="font-mono text-xs">RENAVAM {vehicle?.renavam || 'ausente'}</p></div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div><Label>Tara do veículo (kg)</Label><Input inputMode="numeric" value={form.vehicleTara} onChange={event => update('vehicleTara', event.target.value)} placeholder="Informe uma vez se não estiver cadastrada" /></div>
              <div><Label>RNTRC</Label><Input inputMode="numeric" value={form.rntrc} onChange={event => update('rntrc', event.target.value)} placeholder="8 dígitos" /></div>
              <div><Label>CIOT</Label><Input inputMode="numeric" value={form.ciot} onChange={event => update('ciot', event.target.value)} placeholder="12 dígitos" /></div>
              <div><Label>CPF/CNPJ responsável pelo CIOT</Label><Input inputMode="numeric" value={form.ciotResponsible} onChange={event => update('ciotResponsible', event.target.value)} /></div>
              <div className="md:col-span-2"><Label>Averbações</Label><Input value={form.endorsements} onChange={event => update('endorsements', event.target.value)} placeholder="Carregadas dos CT-es; separe por vírgula" /></div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div><Label>Origem</Label><Input value={form.originCity} onChange={event => update('originCity', event.target.value)} /></div>
              <div><Label>IBGE origem</Label><Input value={form.originIbge} onChange={event => update('originIbge', digits(event.target.value))} /></div>
              <div><Label>UF origem</Label><Input value={form.originUf} onChange={event => update('originUf', event.target.value.toUpperCase())} maxLength={2} /></div>
              <div><Label>Destino</Label><Input value={form.destinationCity} onChange={event => update('destinationCity', event.target.value)} /></div>
              <div><Label>IBGE destino</Label><Input value={form.destinationIbge} onChange={event => update('destinationIbge', digits(event.target.value))} /></div>
              <div><Label>UF destino</Label><Input value={form.destinationUf} onChange={event => update('destinationUf', event.target.value.toUpperCase())} maxLength={2} /></div>
            </div>

            {ctes.length > 0 && (
              <div className="max-h-56 overflow-auto rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>CT-e</TableHead><TableHead>Destino</TableHead><TableHead>Chave</TableHead><TableHead className="text-right">Peso</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {ctes.map(document => (
                      <TableRow key={document.id}>
                        <TableCell className="font-medium">{document.cte_number || '—'}</TableCell>
                        <TableCell>{document.recipient_city || '—'}{document.recipient_state ? `/${document.recipient_state}` : ''}</TableCell>
                        <TableCell className="font-mono text-xs">{document.access_key?.slice(-16) || 'Sem chave'}</TableCell>
                        <TableCell className="text-right">{Number(document.cargo_weight || 0).toLocaleString('pt-BR')} kg</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <Button variant="outline" onClick={() => { void refetchCtes(); void refetchManifest(); }}>
                <RefreshCw className="mr-1 h-4 w-4" /> Recarregar dados
              </Button>
              <div className="text-right">
                <Button onClick={handleIssue} disabled={!readyToIssue || issueMdfe.isPending}>
                  {issueMdfe.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                  {form.environment === 'production' ? 'Emitir MDF-e em produção' : 'Emitir MDF-e'}
                </Button>
                {!readyToIssue && <p className="mt-1 max-w-xl text-xs text-muted-foreground">Complete os campos pendentes, confirme credencial, CT-es autorizados, seguro e produto predominante.</p>}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
