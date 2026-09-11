import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {Button} from '@/components/ui/button';
import {MovementEntryDialog} from './MovementEntryDialog';
export function ReconciliationMovementEntry({account}:{account:string}){
 const {currentTenant}=useTenant(),{user}=useAuth();
 if(!currentTenant||!user)return null;
 return <Entry key={`${currentTenant.id}:${user.id}`} tenant={currentTenant.id} actor={user.id} account={account}/>;
}
function Entry({tenant,actor,account}:{tenant:string;actor:string;account:string}){
 const [open,setOpen]=useState(false),[recorded,setRecorded]=useState(false),qc=useQueryClient();
 return <div className="space-y-1"><Button variant="outline" size="sm" disabled={!account} onClick={()=>setOpen(true)}>Registrar movimentação</Button>
  {recorded&&<p role="status" className="text-sm">Movimentação registrada; não foi criada uma linha de extrato. <Link className="underline" to="/financial/movements">Consultar movimentações</Link></p>}
  {open&&<MovementEntryDialog tenant={tenant} actor={actor} initialAccount={account} onClose={()=>setOpen(false)} onRecorded={()=>{setOpen(false);setRecorded(true);void invalidateAccountReview(qc,tenant);for(const prefix of ['finance-movements','finance-audit','finance-reconciliation-options','finance-automatic-reconciliation'])void qc.invalidateQueries({queryKey:[prefix]});}}/>}
 </div>;
}
