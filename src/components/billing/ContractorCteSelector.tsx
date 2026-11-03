import { useState } from 'react';
import { useContractorCteSources } from '@/hooks/useContractorCteSources';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { stateFromCteCity, type CteSubcontractingSelection } from '@/lib/fiscal/cteSubcontracting';

export default function ContractorCteSelector({ value, onChange, disabled, tenantId }: {
  value: CteSubcontractingSelection | null | undefined;
  onChange: (value: CteSubcontractingSelection | null) => void;
  disabled: boolean;
  tenantId: string;
}) {
  const [search, setSearch] = useState('');
  const sources = useContractorCteSources(search);
  const options = (sources.data || []).filter(s => s.tenant_id === tenantId && s.environment === 'production');
  const selected = value?.source.tenant_id === tenantId ? value : null;
  return <fieldset disabled={disabled} className="space-y-3 rounded border p-3">
    <legend className="px-1 font-medium text-sm">CT-e da contratante</legend>
    <p className="text-xs text-muted-foreground">Importe o XML ou PDF/DACTE em Importação de documentos antes de selecionar. O tomador será a transportadora contratante. Confira remetente, destinatário, frete e, na aba Fiscal, CFOP e ICMS da operação.</p>
    <Label htmlFor="cte-parent-search">Buscar chave do CT-e original</Label>
    <Input id="cte-parent-search" value={search} onChange={event => setSearch(event.target.value.replace(/\D/g, '').slice(0, 44))} />
    <Label htmlFor="cte-parent-source">Selecionar CT-e original</Label>
    <Select disabled={disabled || sources.isLoading} value={selected?.source.id || 'none'} onValueChange={id => {
      const source = options.find(s => s.id === id);
      onChange(source ? { source, originName: source.document.origin_city_code === source.document.issuer_address.city_code ? source.document.issuer_address.city : '', destinationName: '', confirmed: false } : null);
    }}>
      <SelectTrigger id="cte-parent-source"><SelectValue placeholder="Selecione o documento importado" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Selecione o CT-e da contratante</SelectItem>
        {selected && !options.some(s => s.id === selected.source.id) && <SelectItem value={selected.source.id}>CT-e {selected.source.document.number} — {selected.source.document.issuer_name}</SelectItem>}
        {options.map(source => <SelectItem key={source.id} value={source.id}>CT-e {source.document.number}/{source.document.series} — {source.document.issuer_name} ({source.source_format.toUpperCase()})</SelectItem>)}
      </SelectContent>
    </Select>
    <Button type="button" variant="outline" size="sm" disabled={disabled || sources.isFetching} onClick={() => void sources.refetch()}>Atualizar documentos</Button>
    {sources.isError && <p role="alert" className="text-sm text-destructive">Falha ao consultar documentos. Atualize a lista.</p>}
    {!sources.isLoading && !sources.isError && !options.length && <p className="text-xs">Nenhum CT-e de produção encontrado. A busca mostra até 50 documentos.</p>}
    {selected && <>
      <p className="text-xs break-all">Chave: {selected.source.access_key}</p>
      <p className="text-sm">Tomador: {selected.source.document.issuer_name} · {selected.source.document.issuer_cnpj}</p>
      {(['origin', 'destination'] as const).map(side => {
        const origin = side === 'origin';
        const code = origin ? selected.source.document.origin_city_code : selected.source.document.destination_city_code;
        return <div key={side}>
          <Label htmlFor={`cte-parent-${side}`}>{origin ? 'Município de início' : 'Município de término'} do CT-e original · {code}/{stateFromCteCity(code)}</Label>
          <Input id={`cte-parent-${side}`} value={origin ? selected.originName : selected.destinationName} onChange={e => onChange({ ...selected, [origin ? 'originName' : 'destinationName']: e.target.value, confirmed: false })} maxLength={60} />
        </div>;
      })}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={selected.confirmed} onChange={e => onChange({ ...selected, confirmed: e.target.checked })} />Conferi no original a chave, a situação fiscal, as notas, o trajeto completo, os dados da contratante e a tributação. PDF/DACTE exige conferência manual; importar não valida autorização na SEFAZ.</label>
    </>}
  </fieldset>;
}
