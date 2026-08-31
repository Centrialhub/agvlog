import {useState} from 'react';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useExpenseReview} from '@/hooks/useExpenseReview';
import {expenseReviewError} from '@/lib/financial/expenseReviewCommands';
import {Button} from '@/components/ui/button';
export function ExpenseReviewRecoveryPanel(){
 const api=useExpenseReview();const {currentTenant}=useTenant();const {user}=useAuth();const scope=currentTenant?.id+':'+user?.id;
 const [notice,setNotice]=useState({scope,message:''});const message=notice.scope===scope?notice.message:'';
 if(!api.pending&&!api.recoveryError&&!message)return null;
 return <section aria-label="Recuperação de revisão de despesas" className="mb-4 space-y-2 rounded border p-3">
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}
  {api.pending?<><p>Revisão sem confirmação: {api.pending.payload.action==='approve'?'aprovação':'rejeição'}. Recupere o pedido existente.</p><Button disabled={api.isPending} onClick={async()=>{
   setNotice({scope,message:''});try{const result=await api.recover();setNotice({scope,message:'Revisão recuperada: despesa '+(result.status==='approved'?'aprovada':'rejeitada')+'. Consulte o estado atual na listagem.'});}
   catch(cause){setNotice({scope,message:expenseReviewError(cause)});}
  }}>Recuperar revisão de despesa</Button></>:null}{message?<p role="status">{message}</p>:null}
 </section>;
}
