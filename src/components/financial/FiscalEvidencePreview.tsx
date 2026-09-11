import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {readFiscalEvidencePreview} from '@/lib/financial/fiscalEvidencePreviewClient';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
const labels:Record<string,string>={nfse_authorization_layout_not_reviewed:'Este formato de NFS-e ainda não possui conferência automática homologada.',cte_xml_version_unsupported:'A versão do XML do CT-e não é suportada nesta conferência.',xml_authorization_mismatch:'O protocolo ou estado de autorização não confere no XML.',xml_emission_identity_mismatch:'A identidade do XML não corresponde à emissão registrada.',stored_protocol_differs:'O protocolo do XML difere do registro atual.',xml_amount_invalid:'O valor do XML não pôde ser validado em centavos.',stored_emission_not_authorized:'A emissão registrada não está autorizada em produção.',xml_document_type_mismatch:'O arquivo não corresponde ao tipo fiscal solicitado.'};
export function FiscalEvidencePreview({tenant,actor,observation}:{tenant:string;actor:string;observation:string}){
 const [requested,setRequested]=useState(false);
 const query=useQuery({queryKey:['finance-fiscal-evidence-preview',tenant,actor,observation],enabled:requested,retry:false,staleTime:0,refetchOnWindowFocus:false,queryFn:()=>readFiscalEvidencePreview(tenant,observation)});
 const result=!query.isFetching&&!query.error?query.data:undefined;
 return <section className="mt-3 space-y-2"><Button variant="outline" disabled={query.isFetching} onClick={()=>{if(requested)void query.refetch();else setRequested(true);}}>{query.isFetching?'Consultando XML existente…':'Conferir XML existente'}</Button>
 {requested&&<p className="text-xs">Consulta um documento já emitido. Não emite outro documento, não altera cobranças e não registra recebimento.</p>}
 {query.error&&<p role="alert">Não foi possível conferir o XML existente. Tente novamente; nenhum título foi alterado.</p>}
 {result&&<div className="rounded border p-3 text-sm"><p>Conferência preliminar — assinatura digital não verificada.</p><p>Identidade do documento: {result.identity_matches?'campos conferidos':'não confirmada'}.</p><p>Valor encontrado no XML: {result.amount_cents===null?'Não validado':formatFinanceCents(result.amount_cents)}.</p><p>Protocolo encontrado: {result.protocol||'Não validado'}.</p>{result.issues.length?<ul>{result.issues.map(issue=><li key={issue}>{labels[issue]||'A evidência exige conferência adicional.'}</li>)}</ul>:<p>As conferências estruturais passaram. Isso não libera projeção ou baixa automática.</p>}<details><summary>Identificação do arquivo consultado</summary><p className="break-all">SHA-256: {result.sha256}</p><p>{result.size_bytes} bytes · {result.format}</p></details></div>}
 </section>;
}
