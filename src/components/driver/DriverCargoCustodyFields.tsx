import { AlertTriangle, CheckCircle2, ClipboardCheck, PackageCheck, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { tripCargoDocumentLabels, tripCargoSealStatusLabels, type TripCargoAvailableSnapshot } from '@/lib/driver/tripCargoCustody';
import type { TripCargoLoadDraft } from '@/lib/driver/tripCargoConfirmation';

type SealResolutionValue = { status: 'removed' | 'broken' | 'missing'; reason: string; file: File | null; path: string | null };

interface Props {
  snapshot: TripCargoAvailableSnapshot;
  status: TripCargoAvailableSnapshot['control']['status'];
  usingCachedCargo: boolean;
  isOnline: boolean;
  executePending: boolean;
  canEdit: boolean;
  pendingDivergences: TripCargoAvailableSnapshot['divergences'];
  installedSeals: TripCargoAvailableSnapshot['seals'];
  loads: TripCargoLoadDraft[];
  documents: string[];
  vehicleChecked: boolean;
  tieDown: boolean;
  seal: string;
  sealReason: string;
  evidence: { kind: string }[];
  sealResolutions: Record<string, SealResolutionValue>;
  divergenceKind: string;
  divergence: string;
  divergenceLoadId: string;
  divergenceDocumentId: string;
  divergenceDocuments: TripCargoAvailableSnapshot['documents'];
  evidenceComplete: boolean;
  loadLabel: (loadId: string) => string;
  parseSealNumbers: (value: string) => string[];
  initialCargoWeight: (value: number) => { value: string; raw: string; rounded: boolean; error: string | null };
  onLoadChange: (index: number, field: keyof Omit<TripCargoLoadDraft, 'load_id'>, value: string) => void;
  onDocumentChange: (id: string, checked: boolean | 'indeterminate') => void;
  onVehicleChecked: (checked: boolean | 'indeterminate') => void;
  onTieDownChecked: (checked: boolean | 'indeterminate') => void;
  onSealChange: (value: string) => void;
  onSealReasonChange: (value: string) => void;
  onSealInstallationChange: (sealNumber: string, file: File | null) => void;
  onEvidenceChange: (index: number, file: File | null) => void;
  onDivergenceKindChange: (kind: string) => void;
  onDivergenceLoadChange: (loadId: string) => void;
  onDivergenceDocumentChange: (documentId: string) => void;
  onDivergenceChange: (value: string) => void;
  onSealResolutionChange: (id: string, draft: SealResolutionValue, patch: Partial<SealResolutionValue>) => void;
  onStartLoading: () => void;
  onConfirm: () => void;
  onChecklist: () => void;
  onDepart: () => void;
  onResolveInstalledSeals: () => void;
  onReturn: () => void;
}

export default function DriverCargoCustodyFields({
  snapshot,
  status,
  usingCachedCargo,
  isOnline,
  executePending,
  canEdit,
  pendingDivergences,
  installedSeals,
  loads,
  documents,
  vehicleChecked,
  tieDown,
  seal,
  sealReason,
  evidence,
  sealResolutions,
  divergenceKind,
  divergence,
  divergenceLoadId,
  divergenceDocumentId,
  divergenceDocuments,
  evidenceComplete,
  loadLabel,
  parseSealNumbers,
  initialCargoWeight,
  onLoadChange,
  onDocumentChange,
  onVehicleChecked,
  onTieDownChecked,
  onSealChange,
  onSealReasonChange,
  onSealInstallationChange,
  onEvidenceChange,
  onDivergenceKindChange,
  onDivergenceLoadChange,
  onDivergenceDocumentChange,
  onDivergenceChange,
  onSealResolutionChange,
  onStartLoading,
  onConfirm,
  onChecklist,
  onDepart,
  onResolveInstalledSeals,
  onReturn,
}: Props) {
  return <>
    {usingCachedCargo && <Card className="border-amber-300"><CardContent className="p-3 text-xs" role="status">
      Exibindo carga, documentos e referências salvos no aparelho. As alterações exigem conexão.
    </CardContent></Card>}

    {status === 'accepted' && <Button className="w-full" disabled={executePending || usingCachedCargo || !isOnline}
      onClick={onStartLoading}><PackageCheck className="h-4 w-4 mr-2" />Iniciar carregamento</Button>}

    {canEdit && <>
      <Card><CardHeader><CardTitle className="text-sm">Volumes, pallets e peso</CardTitle></CardHeader><CardContent className="space-y-3">
        {loads.map((row, index) => <div key={row.load_id} className="rounded-md border p-3 space-y-2">
          <p className="text-xs font-medium">Carga {loadLabel(row.load_id)}</p>
          {(() => {
            const original = snapshot.loads.find(item => item.load_id === row.load_id);
            const weight = initialCargoWeight(original?.confirmed_weight_kg ?? original?.expected_weight_kg ?? 0);
            if (weight.error) return <p role="alert" className="text-xs text-destructive">{weight.error}</p>;
            return weight.rounded && <p className="text-xs text-muted-foreground" role="note">
              Peso recebido: {weight.raw.replace('.', ',')} kg. Arredondado para conferência: {weight.value.replace('.', ',')} kg, com duas casas decimais.
            </p>;
          })()}
          <div className="grid grid-cols-3 gap-2">
            {([['volume_count', 'Volumes'], ['pallet_count', 'Pallets'], ['weight_kg', 'Peso kg']] as const).map(([field, label]) => <div key={field}>
              <Label htmlFor={`${field}-${row.load_id}`} className="text-[11px]">{label}</Label>
              <Input id={`${field}-${row.load_id}`} type="number" min="0" step={field === 'pallet_count' ? '1' : '0.01'} value={row[field]}
                onChange={event => onLoadChange(index, field, event.target.value)} />
            </div>)}
          </div>
        </div>)}
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-sm">Documentos e referências</CardTitle></CardHeader><CardContent className="space-y-2">
        {snapshot.documents.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum documento fiscal ou referência cadastrada.</p>
          : snapshot.documents.map(document => <label key={document.id} className="flex items-start gap-2 rounded border p-2 text-xs">
            <Checkbox checked={documents.includes(document.id)} onCheckedChange={checked => onDocumentChange(document.id, checked)} />
            <span>{tripCargoDocumentLabels[document.source_kind]} {document.reference_number}</span>
          </label>)}
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-sm">Segurança, lacre e fotos</CardTitle></CardHeader><CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={vehicleChecked} onCheckedChange={onVehicleChecked} />Veículo conferido</label>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={tieDown} onCheckedChange={onTieDownChecked} />Carga amarrada e estabilizada</label>
        <div><Label htmlFor="cargo-seals">Lacres</Label><Input id="cargo-seals" value={seal} onChange={event => onSealChange(event.target.value)} placeholder="Separe múltiplos lacres por vírgula" /></div>
        {!seal.trim() && <div><Label htmlFor="seal-na">Motivo sem lacre</Label><Input id="seal-na" value={sealReason} onChange={event => onSealReasonChange(event.target.value)} placeholder="Ex.: veículo baú sem ponto de lacre" /></div>}
        {parseSealNumbers(seal).map(sealNumber => <div key={sealNumber}><Label htmlFor={`cargo-photo-seal-${sealNumber}`}>Foto do lacre {sealNumber} instalado</Label>
          <Input id={`cargo-photo-seal-${sealNumber}`} type="file" accept="image/*" capture="environment"
            onChange={event => onSealInstallationChange(sealNumber, event.target.files?.[0] ?? null)} />
        </div>)}
        {evidence.slice(0, 2).map((item, index) => <div key={item.kind}>
          <Label htmlFor={`cargo-photo-${item.kind}`}>{item.kind === 'loading' ? 'Foto da carga' : 'Foto da amarração'}</Label>
          <Input id={`cargo-photo-${item.kind}`} type="file" accept="image/*" capture="environment"
            onChange={event => onEvidenceChange(index, event.target.files?.[0] ?? null)} />
        </div>)}
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-sm">Avaria, falta ou sobra</CardTitle></CardHeader><CardContent className="space-y-2">
        <select aria-label="Tipo de divergência" className="w-full rounded-md border bg-background p-2 text-sm" value={divergenceKind} onChange={event => onDivergenceKindChange(event.target.value)}>
          <option value="">Sem divergência adicional</option><option value="damage">Avaria</option><option value="shortage">Falta</option>
          <option value="surplus">Sobra</option><option value="document">Documento</option><option value="seal">Lacre</option><option value="other">Outra</option>
        </select>
        {divergenceKind && divergenceKind !== 'seal' && snapshot.loads.length > 1 && <div>
          <Label htmlFor="cargo-divergence-load">Carga afetada</Label>
          <select id="cargo-divergence-load" aria-label="Carga afetada" className="w-full rounded-md border bg-background p-2 text-sm"
            value={divergenceLoadId} onChange={event => onDivergenceLoadChange(event.target.value)}>
            <option value="">{['damage', 'shortage', 'surplus', 'volume', 'pallet', 'weight'].includes(divergenceKind)
              ? 'Selecione a carga' : 'Toda a viagem / não se aplica'}</option>
            {snapshot.loads.map(load => <option key={load.load_id} value={load.load_id}>Carga {loadLabel(load.load_id)}</option>)}
          </select>
        </div>}
        {divergenceKind === 'document' && <div>
          <Label htmlFor="cargo-divergence-document">Documento afetado</Label>
          <select id="cargo-divergence-document" aria-label="Documento afetado" className="w-full rounded-md border bg-background p-2 text-sm"
            value={divergenceDocumentId} onChange={event => onDivergenceDocumentChange(event.target.value)}>
            <option value="">Selecione o documento</option>
            {divergenceDocuments.map(document => <option key={document.id} value={document.id}>
              {tripCargoDocumentLabels[document.source_kind]} {document.reference_number}
            </option>)}
          </select>
        </div>}
        {divergenceKind && <Textarea value={divergence} onChange={event => onDivergenceChange(event.target.value)} placeholder="Descreva o que foi encontrado" maxLength={2000} />}
        {divergenceKind && <div><Label htmlFor="cargo-photo-divergence">Foto da divergência {['damage', 'shortage', 'surplus'].includes(divergenceKind) ? '(obrigatória)' : '(opcional)'}</Label>
          <Input id="cargo-photo-divergence" type="file" accept="image/*" capture="environment"
            onChange={event => onEvidenceChange(2, event.target.files?.[0] ?? null)} />
        </div>}
      </CardContent></Card>

      <Button className="w-full" disabled={executePending || usingCachedCargo || !isOnline || !vehicleChecked || !tieDown || !evidenceComplete}
        onClick={onConfirm}><CheckCircle2 className="h-4 w-4 mr-2" />Confirmar conferência da carga</Button>
    </>}

    {pendingDivergences.length > 0 && <Card role="alert" className="border-amber-400"><CardContent className="p-4 space-y-2">
      <p className="flex items-center gap-2 font-medium text-sm"><AlertTriangle className="h-4 w-4" />Aguardando decisão operacional</p>
      {pendingDivergences.map(item => <p key={item.id} className="text-xs">{item.description} · {item.status === 'rejected' ? 'rejeitada' : 'pendente'}</p>)}
    </CardContent></Card>}

    {status === 'ready_to_depart' && <Card><CardContent className="p-4 space-y-3">
      <p className="text-sm">A carga está conferida. O checklist pré-viagem precisa estar completo para registrar a saída.</p>
      <Button variant="outline" className="w-full" onClick={onChecklist}><ClipboardCheck className="h-4 w-4 mr-2" />Abrir checklist pré-viagem</Button>
      <Button className="w-full" disabled={executePending} onClick={onDepart}><Truck className="h-4 w-4 mr-2" />Registrar saída e iniciar viagem</Button>
    </CardContent></Card>}

    {status === 'departed' && <Card><CardContent className="p-4 space-y-3">
      {snapshot.trip_status === 'in_transit' || snapshot.trip_status === 'in_progress' || snapshot.trip_status === 'completed' ? <>
        <p className="text-sm">Após concluir todas as paradas, preencha o checklist pós-viagem e registre o retorno físico.</p>
        <Button variant="outline" className="w-full" onClick={onChecklist}>Abrir checklist pós-viagem</Button>
        {installedSeals.length > 0 && <div className="space-y-3 rounded-md border border-amber-300 p-3">
          <p className="text-sm font-medium">Conferência dos lacres no retorno</p>
          <p className="text-xs text-muted-foreground">Cada lacre exige situação, motivo e foto. Lacre rompido ou ausente abre divergência operacional.</p>
          {installedSeals.map(row => {
            const draft = sealResolutions[row.id] ?? { status: 'removed' as const, reason: '', file: null, path: null };
            return <div key={row.id} className="space-y-2 rounded border p-2">
              <p className="text-xs font-medium">Lacre {row.seal_number}</p>
              <select aria-label={`Situação do lacre ${row.seal_number}`} className="w-full rounded-md border bg-background p-2 text-sm" value={draft.status}
                onChange={event => onSealResolutionChange(row.id, draft, { status: event.target.value as SealResolutionValue['status'] })}>
                <option value="removed">Removido íntegro</option><option value="broken">Rompido</option><option value="missing">Ausente</option>
              </select>
              <Input aria-label={`Motivo do lacre ${row.seal_number}`} value={draft.reason} placeholder="Descreva a conferência física"
                onChange={event => onSealResolutionChange(row.id, draft, { reason: event.target.value })} />
              <Input aria-label={`Foto do lacre ${row.seal_number}`} type="file" accept="image/*" capture="environment"
                onChange={event => onSealResolutionChange(row.id, draft, { file: event.target.files?.[0] ?? null, path: null })} />
            </div>;
          })}
          <Button variant="outline" className="w-full" disabled={executePending || !isOnline || usingCachedCargo}
            onClick={onResolveInstalledSeals}>Salvar conferência dos lacres</Button>
        </div>}
        <Button className="w-full" disabled={executePending || snapshot.trip_status !== 'completed' || installedSeals.length > 0}
          onClick={onReturn}>Registrar retorno à base</Button>
      </> : <>
        <p className="text-sm">A custódia foi assumida, mas o início operacional da viagem ainda não foi confirmado.</p>
        <Button className="w-full" disabled={executePending} onClick={onDepart}>Tentar confirmar início da viagem</Button>
      </>}
    </CardContent></Card>}

    {status === 'returned' && <Card><CardContent className="p-4 space-y-2">
      <p className="font-medium text-sm">Carga retornada; custódia aguardando encerramento operacional.</p>
      <p className="text-xs text-muted-foreground">Canhotos físicos pendentes: {snapshot.physical_receipts.pending_count} · canhotos ausentes: {snapshot.physical_receipts.missing_count}</p>
      {snapshot.seals.map(row => <p key={row.id} className="text-xs">Lacre {row.seal_number}: {tripCargoSealStatusLabels[row.status]}{row.resolution_reason ? ` · ${row.resolution_reason}` : ''}</p>)}
    </CardContent></Card>}
    {status === 'closed' && <Card><CardContent className="p-4 text-sm">Custódia encerrada pela operação.</CardContent></Card>}
  </>;
}
