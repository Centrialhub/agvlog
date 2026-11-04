import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw } from 'lucide-react';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useContractorCteSources } from '@/hooks/useContractorCteSources';
import { importContractorCte, downloadContractorCteOriginal, type ContractorCteSource } from '@/lib/ingestion/contractorCteRepository';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ContractorCteReview from './ContractorCteReview';

export default function ContractorCteImport() {
  const { currentTenant, currentRole } = useTenant();
  const { user } = useAuth();
  if (!currentTenant || !user || !['owner', 'admin', 'operator'].includes(currentRole ?? '')) return <p>Selecione uma empresa com acesso operacional para importar CT-e.</p>;
  return <ImportPanel key={`${currentTenant.id}:${user.id}:${currentRole}`} tenantId={currentTenant.id} actorId={user.id} />;
}

function ImportPanel({ tenantId, actorId }: { tenantId: string; actorId: string }) {
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const sources = useContractorCteSources(search);
  const qc = useQueryClient();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function download(source: ContractorCteSource) {
    setError(''); setDownloading(source.id);
    try {
      const blob = await downloadContractorCteOriginal(source);
      if (!alive.current) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `CTe-${source.access_key}.${source.source_format}`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Falha ao baixar o original.'); }
    finally { if (alive.current) setDownloading(null); }
  }
  return <div className="space-y-6">
    <p className="rounded border bg-muted/30 p-3 text-sm">Após importar, abra a prévia de emissão do CT-e e, na aba Transporte, escolha o serviço Subcontratação e selecione o CT-e da contratante. Confira os dados antes de transmitir. Importar aqui não emite um documento fiscal.</p>
    <ContractorCteReview scopeKey={`${tenantId}:${actorId}`} onConfirm={async (file, document) => {
      await importContractorCte(tenantId, actorId, file, document);
      await qc.invalidateQueries({ queryKey: ['contractor-cte-sources'] });
    }} />
    <div className="space-y-3">
      <h3 className="font-semibold">CT-es de origem cadastrados</h3>
      <Label htmlFor="contractor-cte-search">Buscar pela chave de acesso</Label>
      <Input id="contractor-cte-search" value={search} onChange={event => setSearch(event.target.value.replace(/\D/g, '').slice(0, 44))} />
      <p className="text-xs text-muted-foreground">Até 50 documentos mais recentes. Use a chave para localizar documentos anteriores.</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void sources.refetch()} disabled={sources.isFetching}><RefreshCw className="mr-2 h-4 w-4" />Atualizar lista</Button>
      {(error || sources.isError) && <p role="alert" className="text-sm text-destructive">{error || 'Não foi possível consultar os documentos. Tente atualizar a lista.'}</p>}
      {sources.isLoading ? <p role="status">Consultando CT-es de origem...</p> : !sources.isError && !sources.data?.length && <p>Nenhum CT-e de origem encontrado.</p>}
      {sources.data?.map(source => <article key={source.id} className="rounded border p-3 space-y-1">
        <p className="font-medium">CT-e {source.document.number} / série {source.document.series} — {source.document.issuer_name}</p>
        <p className="text-xs break-all">{source.access_key}</p>
        <p className="text-xs text-muted-foreground">{source.source_format.toUpperCase()} · {source.environment === 'production' ? 'Produção' : 'Homologação'} · {source.document.issue_date}</p>
        <Button type="button" variant="ghost" size="sm" disabled={downloading !== null} onClick={() => void download(source)}><Download className="mr-2 h-4 w-4" />Baixar original</Button>
      </article>)}
    </div>
  </div>;
}
