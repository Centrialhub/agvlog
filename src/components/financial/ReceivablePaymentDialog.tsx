import type {Receivable} from '@/hooks/useReceivables';
import {ReceivableFinancialDialog} from './ReceivableFinancialDialog';
export default function ReceivablePaymentDialog({receivable,open,onOpenChange}:{receivable:Receivable|null;open:boolean;onOpenChange:(open:boolean)=>void}){
 return open&&receivable?<ReceivableFinancialDialog receivableId={receivable.id} tenantId={receivable.tenant_id} onClose={()=>onOpenChange(false)}/>:null;
}
