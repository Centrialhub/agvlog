import {useEffect,useRef,useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {useTenant} from './useTenant';
import {useAuth} from './useAuth';
import {createEmployeeAdvanceRegistrationOutbox,pendingEmployeeAdvanceRegistration,lockEmployeeAdvanceRegistration,employeeAdvanceRegistrationKey,type EmployeeAdvanceRegistrationInput,type PendingEmployeeAdvanceRegistration} from '@/lib/financial/employeeAdvanceRegistrationOutbox';
import {sendEmployeeAdvanceRegistration} from '@/lib/financial/employeeAdvanceRegistrationClient';
export function useEmployeeAdvanceRegistration(){
 const {currentTenant}=useTenant(),{user}=useAuth(),cache=useQueryClient(),tenant=currentTenant?.id,actor=user?.id;
 const live=useRef({tenant,actor,active:true});live.current={tenant,actor,active:true};const [pending,setPending]=useState<PendingEmployeeAdvanceRegistration|null>(null),[storageError,setStorageError]=useState('');
 const sync=()=>{try{setPending(tenant&&actor?pendingEmployeeAdvanceRegistration(localStorage,tenant,actor):null);setStorageError('');}catch{setStorageError('O pedido salvo está indisponível. Preserve os dados antes de registrar outro adiantamento.');}};const syncRef=useRef(sync);syncRef.current=sync;
 const [outbox]=useState(()=>createEmployeeAdvanceRegistrationOutbox({storage:localStorage,uuid:()=>crypto.randomUUID(),lock:lockEmployeeAdvanceRegistration,send:sendEmployeeAdvanceRegistration,changed:()=>{if(live.current.active)syncRef.current();},assertContext:(t,a)=>{if(!live.current.active||live.current.tenant!==t||live.current.actor!==a)throw Error('Retome o cadastro na empresa e sessão originais.');}}));
 useEffect(()=>{live.current.active=true;syncRef.current();const listen=(event:StorageEvent)=>{if(!event.key||tenant&&actor&&event.key===employeeAdvanceRegistrationKey(tenant,actor))syncRef.current();};window.addEventListener('storage',listen);return()=>{live.current.active=false;window.removeEventListener('storage',listen);};},[tenant,actor]);
 const mutation=useMutation({mutationFn:async(input:EmployeeAdvanceRegistrationInput|null)=>{if(!tenant||!actor)throw Error('Selecione uma empresa e sessão válidas.');return input?outbox.submit(tenant,actor,input):outbox.recover(tenant,actor);},onSuccess:()=>{void Promise.all(['employee_advances','finance-payable-portfolio','finance-audit'].map(prefix=>cache.invalidateQueries({queryKey:[prefix,tenant]}))).catch(()=>{});}});
 return {...mutation,pending:pending?.tenantId===tenant&&pending?.actorId===actor?pending:null,storageError};
}
