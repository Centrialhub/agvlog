import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {FinanceAccessBoundary} from './FinanceAccessBoundary';
import {SettlementPaymentWorkspace} from './SettlementPaymentWorkspace';
export function SettlementPaymentDialog({settlement,initialAmount,allowNew=true,onClose}:{settlement:string;initialAmount:number;allowNew?:boolean;onClose:()=>void}){
 const {currentTenant}=useTenant(),{user}=useAuth();if(!currentTenant||!user)return null;
 return <FinanceAccessBoundary><SettlementPaymentWorkspace key={`${currentTenant.id}:${user.id}:${settlement}`} tenant={currentTenant.id} actor={user.id} settlement={settlement} initialAmount={initialAmount} allowNew={allowNew} onClose={onClose}/></FinanceAccessBoundary>;
}
