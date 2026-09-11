import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {ManualExpenseWorkspace} from './ManualExpenseWorkspace';
export default function ManualExpenseDialog({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}){
 const {currentTenant}=useTenant(),{user}=useAuth();
 if(!open||!currentTenant||!user)return null;
 return <ManualExpenseWorkspace key={`${currentTenant.id}:${user.id}`} tenant={currentTenant.id} actor={user.id} onClose={()=>onOpenChange(false)}/>;
}
