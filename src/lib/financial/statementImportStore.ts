import {pendingStatementSchema,type PendingStatement} from './statementImportContract';
const storeName='pending';
const keyFor=(tenant:string,actor:string)=>`${tenant}:${actor}`;
function database():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('Armazenamento de recuperação indisponível.'));return;}
    const request=indexedDB.open('agvlog-finance-statements-v1',1);
    request.onupgradeneeded=()=>{request.result.createObjectStore(storeName);};
    request.onerror=()=>reject(new Error('Não foi possível abrir a recuperação do extrato.'));
    request.onblocked=()=>reject(new Error('Feche outras janelas para atualizar a recuperação do extrato.'));
    request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
  });
}
async function transact<T>(mode:IDBTransactionMode,work:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const db=await database();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(storeName,mode);let request:IDBRequest<T>;
    try{request=work(transaction.objectStore(storeName));}catch{db.close();reject(new Error('Não foi possível preservar o pedido de importação.'));return;}
    transaction.oncomplete=()=>{db.close();resolve(request.result);};
    transaction.onabort=()=>{db.close();reject(new Error('Não foi possível preservar o pedido de importação.'));};
    transaction.onerror=()=>{/* onabort reports a failed transaction; never claim a partial write succeeded. */};
  });
}
export const statementImportStore={
  async load(tenant:string,actor:string):Promise<PendingStatement|null>{
    const value=await transact('readonly',store=>store.get(keyFor(tenant,actor)));if(value===undefined)return null;
    const parsed=pendingStatementSchema.parse(value);
    if(parsed.tenant!==tenant||parsed.actor!==actor||parsed.command.tenant_id!==tenant
      ||(parsed.phase==='verify'&&!parsed.receipt)||parsed.receipt&&(parsed.receipt.tenant_id!==tenant||parsed.receipt.request_id!==parsed.command.request_id))throw new Error('Pedido de recuperação incompatível com esta sessão.');
    return parsed;
  },
  async save(row:PendingStatement){await transact('readwrite',store=>store.put(pendingStatementSchema.parse(row),keyFor(row.tenant,row.actor)));},
  async remove(tenant:string,actor:string){await transact('readwrite',store=>store.delete(keyFor(tenant,actor)));},
};
