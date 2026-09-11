import {FinanceUnavailableError} from '@/lib/financial/ledgerClient';
import type {ReactNode} from 'react';
import {useTenant} from '@/hooks/useTenant';
import {useFinanceAccess} from '@/hooks/useFinanceLedger';
import {Button} from '@/components/ui/button';
export function FinanceAccessBoundary({children}:{children:ReactNode}){
  const {currentRole}=useTenant(),access=useFinanceAccess();
  if(!['owner','admin','operator'].includes(currentRole||''))return <p role="alert">Acesso financeiro não permitido.</p>;
  if(access.error)return <p role="alert">{access.error instanceof FinanceUnavailableError?access.error.message:'Não foi possível confirmar o acesso financeiro.'} <Button onClick={()=>void access.refetch()}>Tentar novamente</Button></p>;
  if(access.isPending||!access.isFetchedAfterMount)return <p role="status">Verificando acesso ao financeiro…</p>;
  if(access.data!==true)return <p role="alert">Acesso financeiro não permitido.</p>;
  return children;
}
