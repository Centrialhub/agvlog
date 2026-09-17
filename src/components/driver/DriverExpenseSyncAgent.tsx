import {useEffect,useRef} from 'react';
import {useDriverExpenseSubmission} from '@/hooks/useDriverExpensesOperational';
import {useOnlineStatus} from '@/hooks/useOnlineStatus';

export function DriverExpenseSyncAgent(){
 const online=useOnlineStatus(),queue=useDriverExpenseSubmission(),attemptedKey=useRef('');
 const pendingKey=(queue.pending.data??[]).map(item=>item.requestId).sort().join('|'),isReplaying=queue.replay.isPending;
 useEffect(()=>{
  if(!online||!pendingKey){attemptedKey.current='';return;}
  if(attemptedKey.current!==pendingKey&&!isReplaying){attemptedKey.current=pendingKey;queue.replay.mutate();}
 },[isReplaying,online,pendingKey,queue.replay]);
 return null;
}
