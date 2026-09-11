import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {uploadRecoverableFinanceArtifact} from '@/lib/financial/uploadArtifactRecovery';
import {uploadArtifactStatus,type UploadArtifact} from '@/lib/financial/uploadArtifactContract';
export function QuarantineFileUpload({tenant,actor,account,file}:{tenant:string;actor:string;account:string;file:File}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<UploadArtifact|null>(null),active=useRef(true);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const extension=file.name.split('.').pop()?.toLowerCase(),format=extension==='jpg'?'jpeg':extension;
 if(!['pdf','xls','xlsx','jpeg','png'].includes(format||''))return null;
 async function upload(){
  setBusy(true);setError('');
  try{const artifact=await uploadRecoverableFinanceArtifact({tenantId:tenant,actorId:actor,sourceType:'bank_account',sourceId:account,file,format:format as UploadArtifact['original']['format']});if(active.current)setResult(artifact);}
  catch(e){if(active.current)setError(e instanceof Error?e.message:'Envio sem confirmação. Retome com o mesmo arquivo.');}
  finally{if(active.current)setBusy(false);}
 }
 return <section className="space-y-2 rounded border p-3" aria-label="Preservação do arquivo em quarentena">
  <p className="text-sm">Este formato pode ser preservado em quarentena. Isso não importa lançamentos nem disponibiliza um comprovante analisado.</p>
  {result?<p role="status">{uploadArtifactStatus(result)} Identificação: {result.artifact_id}</p>:<Button type="button" variant="outline" disabled={busy||!account} onClick={()=>void upload()}>{busy?'Preservando arquivo…':'Preservar em quarentena'}</Button>}
  {!account&&<p className="text-sm">Selecione a conta para identificar a origem do arquivo.</p>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
