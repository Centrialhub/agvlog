import {useEffect,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
type Props={tenantId:string;path:string;onClose:()=>void;title?:string;description?:string;alt?:string};
export function ExpenseReceiptDialog({tenantId,path,onClose,title='Comprovante da despesa',description='Arquivo associado à despesa selecionada.',alt='Comprovante da despesa selecionada'}:Props){
 const {user}=useAuth();
 return <ScopedReceipt key={tenantId+':'+user?.id+':'+path} tenantId={tenantId} path={path} onClose={onClose} title={title} description={description} alt={alt}/>;
}
function ScopedReceipt({tenantId,path,onClose,title,description,alt}:Required<Props>){
 const [result,setResult]=useState<{url?:string;error?:string}>({});
 useEffect(()=>{let active=true;
  if(!path.startsWith(tenantId+'/')||path.includes('..')||path.includes('\\')){setResult({error:'Comprovante fora do escopo da empresa.'});return;}
  const timeout=setTimeout(()=>{if(active){active=false;setResult({error:'Tempo de consulta esgotado. Feche e tente novamente.'});}},20000);
  void supabase.storage.from('receipts').createSignedUrl(path,300).then(({data,error})=>{
   if(!active)return;clearTimeout(timeout);
   if(error||!data?.signedUrl||!data.signedUrl.startsWith('https://'))setResult({error:'Comprovante indisponível ou sem permissão de acesso.'});else setResult({url:data.signedUrl});
  },()=>{if(active){clearTimeout(timeout);setResult({error:'Falha ao consultar o comprovante.'});}});
  return()=>{active=false;clearTimeout(timeout);};
 },[tenantId,path]);
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle>
  <DialogDescription>{description}</DialogDescription></DialogHeader>
  {result.error?<p role="alert">{result.error}</p>:result.url?<><a href={result.url} target="_blank" rel="noopener noreferrer">Abrir arquivo do comprovante</a>{/\.pdf$/i.test(path)?<p>Comprovante em PDF. Use o link para abrir o arquivo.</p>:<img src={result.url} alt={alt} className="max-h-[60vh] w-full object-contain"/>}</>:<p role="status">Carregando comprovante...</p>}
 </DialogContent></Dialog>;
}
