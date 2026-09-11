import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {readExpenseArtifacts,previewExpenseArtifact} from '@/lib/financial/expenseArtifactClient';
import {attachExpenseArtifact,loadExpenseArtifactPending} from '@/lib/financial/expenseArtifactOutbox';
import {uploadRecoverableFinanceArtifact} from '@/lib/financial/uploadArtifactRecovery';
import {uploadArtifactStatus,type UploadArtifact} from '@/lib/financial/uploadArtifactContract';
export function ExpenseArtifactPanel(p:{tenant:string;actor:string;expense:string}){return <ScopedPanel key={`${p.tenant}:${p.actor}:${p.expense}`} {...p}/>;}
function ScopedPanel({tenant,actor,expense}:{tenant:string;actor:string;expense:string}){
 const client=useQueryClient(),active=useRef(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [file,setFile]=useState<File|null>(null),[artifact,setArtifact]=useState<UploadArtifact|null>(null),[reason,setReason]=useState(''),[url,setUrl]=useState('');
 const [pending,setPending]=useState<ReturnType<typeof loadExpenseArtifactPending>>(null),[storageBlocked,setStorageBlocked]=useState(false);
 const query=useQuery({queryKey:['finance-expense-artifacts',tenant,actor,expense],queryFn:()=>readExpenseArtifacts(tenant,expense),retry:false});
 const data=!query.isFetching&&!query.isError?query.data:undefined;
 function refreshPending(){try{setPending(loadExpenseArtifactPending(tenant,actor,expense));setStorageBlocked(false);}catch(e){setStorageBlocked(true);setError(e instanceof Error?e.message:'Recuperação indisponível.');}}
 useEffect(()=>{active.current=true;refreshPending();const changed=()=>refreshPending();window.addEventListener('storage',changed);return()=>{active.current=false;window.removeEventListener('storage',changed);};},[]);
 async function upload(){if(!file)return;setBusy(true);setError('');setArtifact(null);
  try{const ext=file.name.split('.').pop()?.toLowerCase(),format=ext==='jpg'?'jpeg':ext;
   if(!['jpeg','png','pdf','xls','xlsx'].includes(format||''))throw new Error('Use JPEG, PNG ou documento para preservar em quarentena.');
   const result=await uploadRecoverableFinanceArtifact({tenantId:tenant,actorId:actor,sourceType:'expense_item',sourceId:expense,file,format:format as UploadArtifact['original']['format']});if(active.current)setArtifact(result);
  }catch(e){if(active.current)setError(e instanceof Error?e.message:'Envio sem confirmação.');}finally{if(active.current)setBusy(false);}
 }
 async function attach(recover=false){setBusy(true);setError('');
  try{await attachExpenseArtifact(tenant,actor,expense,recover?undefined:{artifact:artifact!.artifact_id,reason});if(!active.current)return;
   setNotice('Comprovante anexado. O gasto e seus valores foram preservados.');setArtifact(null);refreshPending();
   try{await Promise.all([client.invalidateQueries({queryKey:['finance-expense-artifacts',tenant]}, {throwOnError:true}),client.invalidateQueries({queryKey:['finance-expenses',tenant]}, {throwOnError:true})]);}catch{if(active.current)setError('O anexo foi confirmado, mas a lista não atualizou. Reabra a consulta.');}
  }catch(e){if(active.current){setError(e instanceof Error?e.message:'Anexo sem confirmação.');refreshPending();}}finally{if(active.current)setBusy(false);}
 }
 async function open(id:string){setUrl('');setError('');setBusy(true);try{const result=await previewExpenseArtifact(tenant,expense,id);if(active.current)setUrl(result.url);}catch(e){if(active.current)setError(e instanceof Error?e.message:'Cópia indisponível.');}finally{if(active.current)setBusy(false);}}
 return <section className="space-y-3 rounded border p-3" aria-label="Comprovantes adicionais do gasto"><h3 className="font-medium">Comprovantes adicionais</h3>
  <p className="text-sm">A cópia JPEG/PNG é reprocessada; o original permanece privado. Anexar não altera custo, obrigação ou dinheiro. Imagens de até 5 MB estão sujeitas aos limites de processamento.</p>
  {query.isFetching&&<p role="status">Consultando comprovantes…</p>}{query.isError&&<p role="alert">Não foi possível consultar os comprovantes deste gasto.</p>}
  {data?.receipts.map(row=><div key={row.link_id} className="rounded border p-2 text-sm"><p>Responsável: {row.actor_id} · {new Date(row.created_at).toLocaleString('pt-BR')}</p><p>{row.reason}</p><p>Identificação: {row.artifact_id}</p><Button type="button" variant="outline" disabled={busy} onClick={()=>void open(row.artifact_id)}>Ver cópia validada</Button></div>)}
  {data&&!data.receipts.length&&<p className="text-sm">Nenhum comprovante adicional anexado.</p>}
  {pending?<div className="rounded border border-amber-600 p-2 text-sm"><p>Anexo aguardando confirmação: {pending.command.artifact_id}</p><p>{pending.command.reason}</p><Button disabled={busy||storageBlocked} onClick={()=>void attach(true)}>Recuperar anexo</Button></div>:!notice&&<fieldset disabled={busy||storageBlocked||!data} className="space-y-2">
   <label className="block text-sm">Arquivo para este gasto<Input aria-label="Arquivo para este gasto" type="file" accept=".jpg,.jpeg,.png,.pdf,.xls,.xlsx" onChange={e=>{setFile(e.target.files?.[0]||null);setArtifact(null);}}/></label>
   <Button type="button" variant="outline" disabled={!file} onClick={()=>void upload()}>Enviar e validar arquivo</Button>
   {artifact&&<p role="status">{uploadArtifactStatus(artifact)}</p>}
   {artifact?.usable&&artifact.state==='sanitized_derivative'&&<><label className="block text-sm">Motivo do anexo<Input value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/></label><Button disabled={reason.trim().length<5} onClick={()=>void attach()}>Anexar cópia validada ao gasto</Button></>}
  </fieldset>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  {url&&data&&<div><a href={url} target="_blank" rel="noopener noreferrer">Abrir cópia validada</a><img src={url} alt="Cópia reprocessada do comprovante deste gasto" className="max-h-96 w-full object-contain"/></div>}
 </section>;
}
