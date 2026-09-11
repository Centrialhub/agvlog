import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {Button} from '@/components/ui/button';
import {StatementImportDialog} from './StatementImportDialog';
export function ReconciliationStatementImport({account,start,end}:{account:string;start:string;end:string}){
 const {currentTenant}=useTenant(),{user}=useAuth();
 if(!currentTenant||!user)return null;
 return <Entry key={`${currentTenant.id}:${user.id}`} tenant={currentTenant.id} actor={user.id} account={account} start={start} end={end}/>;
}
function Entry({tenant,actor,account,start,end}:{tenant:string;actor:string;account:string;start:string;end:string}){
 const [open,setOpen]=useState(false),[notice,setNotice]=useState(''),qc=useQueryClient();
 return <div className="space-y-1"><Button variant="outline" size="sm" disabled={!account} onClick={()=>setOpen(true)}>Importar extrato</Button>
  {notice&&<p role="status" className="text-sm">{notice} <Link className="underline" to="/financial/statements">Abrir extratos e conferência</Link></p>}
  {open&&<StatementImportDialog tenant={tenant} actor={actor} initial={{account,start,end}} onClose={()=>setOpen(false)} onImported={result=>{
   setOpen(false);setNotice(result.source_verification==='rows_match'?'Original preservado e linhas conferidas. A conciliação deve ser acompanhada em Extratos.':result.source_verification==='unreadable'?'Original preservado, mas não foi possível conferir sua leitura. Revise a importação em Extratos.':'Original preservado com divergências na leitura. Revise a importação em Extratos.');
   void invalidateAccountReview(qc,tenant);void qc.invalidateQueries({queryKey:['finance-statements',tenant,actor]});
  }}/>}
 </div>;
}
