import {useEffect,useRef} from 'react';
import {useDriverExpenseSubmission} from '@/hooks/useDriverExpensesOperational';
import {useOnlineStatus} from '@/hooks/useOnlineStatus';

export function DriverExpenseSyncAgent(){
 const online=useOnlineStatus(),queue=useDriverExpenseSubmission(),attempted=useRef(false);
 const pendingCount=queue.pending.data?.length??0,isReplaying=queue.replay.isPending;
 useEffect(()=>{
  if(!online){attempted.current=false;return;}
  if(!attempted.current&&pendingCount&&!isReplaying){attempted.current=true;queue.replay.mutate();}
 },[isReplaying,online,pendingCount,queue.replay]);
 return null;
}
