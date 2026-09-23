import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
type Props={tenantId:string;path:string;onClose:()=>void;title?:string;description?:string;alt?:string};
export function ExpenseReceiptDialog({tenantId,path,onClose,title='Comprovante da despesa',description='Arquivo associado à despesa selecionada.',alt='Comprovante da despesa selecionada'}:Props){
 const {user}=useAuth();
 return <ScopedReceipt key={tenantId+':'+user?.id+':'+path} tenantId={tenantId} path={path} onClose={onClose} title={title} description={description} alt={alt}/>;
}
function ScopedReceipt({tenantId,path,onClose,title,description,alt}:Required<Props>){
 const [result,setResult]=useState<{url?:string;error?:string}>({});
 const request=useRef(0),mounted=useRef(true),[opening,setOpening]=useState(false),[previewFailed,setPreviewFailed]=useState(false);
 const sign=useCallback(async()=>{
  const current=++request.current;
  if(!path.startsWith(tenantId+'/')||path.includes('..')||path.includes('\\')){setResult({error:'Comprovante fora do escopo da empresa.'});return null;}
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
   const response=await Promise.race([
    supabase.storage.from('receipts').createSignedUrl(path,300),
    new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('timeout')),20000);}),
   ]);
   if(!mounted.current||current!==request.current)return null;
   const {data,error}=response;
   if(error||!data?.signedUrl||!data.signedUrl.startsWith('https://')){setResult({error:'Comprovante indisponível ou sem permissão de acesso.'});return null;}
   setResult({url:data.signedUrl});setPreviewFailed(false);return data.signedUrl;
  }catch(cause){if(mounted.current&&current===request.current)setResult({error:cause instanceof Error&&cause.message==='timeout'?'Tempo de consulta esgotado. Tente atualizar o comprovante.':'Falha ao consultar o comprovante.'});return null;}
  finally{if(timeout)clearTimeout(timeout);}
 },[tenantId,path]);
 useEffect(()=>{mounted.current=true;void sign();const renewal=setInterval(()=>void sign(),240000);return()=>{mounted.current=false;clearInterval(renewal);};},[sign]);
 const openFresh=async()=>{setOpening(true);const url=await sign();setOpening(false);if(url){const anchor=document.createElement('a');anchor.href=url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.click();}};
 const pdf=/\.pdf$/i.test(path),externalImage=/\.(heic|heif)$/i.test(path);
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle>
  <DialogDescription>{description}</DialogDescription></DialogHeader>
  {result.error?<><p role="alert">{result.error}</p><Button variant="outline" onClick={()=>void sign()}>Atualizar comprovante</Button></>:result.url?<><Button variant="link" disabled={opening} onClick={()=>void openFresh()}>{opening?'Atualizando link…':'Abrir arquivo do comprovante'}</Button>{pdf?<p>Comprovante em PDF. Use a ação acima para abrir o arquivo.</p>:externalImage?<p>Pré-visualização de HEIC/HEIF não disponível neste navegador. Use a ação acima para abrir ou baixar o arquivo original.</p>:previewFailed?<p role="alert">A pré-visualização não é compatível com este navegador. Use a ação acima para abrir o arquivo original.</p>:<img src={result.url} alt={alt} onError={()=>setPreviewFailed(true)} className="max-h-[60vh] w-full object-contain"/>}</>:<p role="status">Carregando comprovante...</p>}
 </DialogContent></Dialog>;
}
