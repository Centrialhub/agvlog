import type { ReceiptScanResult } from './receiptScan';
import { restoreReceiptScan, storeDriverFile, type StoredReceiptScan } from './driverDeliveryOfflineStore';

const databaseName='agvlog-receipt-captures-v1',storeName='captures';
interface Capture {version:1;scope:string;receipt:StoredReceiptScan}
export function receiptCaptureScope(...parts:Array<string|null|undefined>) {
  return parts.length===5&&parts.every(value=>!!value)?JSON.stringify(parts):undefined;
}

function openDatabase():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined'){reject(new Error('O aparelho não disponibilizou o armazenamento da foto.'));return;}
    const request=indexedDB.open(databaseName,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(storeName,{keyPath:'scope'});
    request.onerror=()=>reject(request.error??new Error('Não foi possível abrir o armazenamento da foto.'));
    request.onblocked=()=>reject(new Error('Feche outras abas do aplicativo para salvar a foto.'));
    request.onsuccess=()=>resolve(request.result);
  });
}
async function transaction<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,mode);let request:IDBRequest<T>;
    try{request=run(tx.objectStore(storeName));}catch(error){db.close();reject(error);return;}
    tx.oncomplete=()=>{db.close();resolve(request.result);};
    tx.onabort=tx.onerror=()=>{db.close();reject(tx.error??new Error('A foto não foi gravada no aparelho. Confira o espaço disponível.'));};
  });
}
export async function saveReceiptCapture(scope:string,scan:ReceiptScanResult):Promise<void>{
  if(!scope)throw new Error('A foto não está vinculada a uma entrega.');
  const receipt:StoredReceiptScan={...scan,original:storeDriverFile(scan.original),processed:storeDriverFile(scan.processed),
    thumbnail:scan.thumbnail?storeDriverFile(scan.thumbnail):undefined};
  await transaction('readwrite',store=>store.put({version:1,scope,receipt} satisfies Capture));
}
export async function loadReceiptCapture(scope:string):Promise<ReceiptScanResult|null>{
  const row=await transaction<unknown>('readonly',store=>store.get(scope));
  if(!row)return null;
  const value=row as Partial<Capture>;
  if(value.version!==1||value.scope!==scope||!value.receipt||!(value.receipt.original?.blob instanceof Blob)
    ||!(value.receipt.processed?.blob instanceof Blob)||!value.receipt.original.blob.size||!value.receipt.processed.blob.size){
    throw new Error('A cópia da foto não pôde ser conferida. Fotografe novamente antes de confirmar a entrega.');
  }
  return restoreReceiptScan(value.receipt);
}
/** Only discard the capture copy after the delivery's existing durable transport confirms its result. */
export async function removeReceiptCapture(scope:string):Promise<void>{
  await transaction('readwrite',store=>store.delete(scope));
}
