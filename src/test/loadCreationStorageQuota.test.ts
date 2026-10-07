import {beforeEach,expect,it,vi} from 'vitest';
import {createLoadCreationOutbox,readPendingLoadCreations,type PendingLoadCreation,type LoadCreationInput} from '@/lib/loads/loadCreationOutbox';
import {deserializeLoadCreation,serializeLoadCreation} from '@/lib/loads/loadCreationStorageCodec';

const key='agvlog:load-creation:v1:tenant:actor:documents:manual';
const largeInput=():LoadCreationInput=>{
 const invoices=Array.from({length:503},(_,n)=>'M3-20261005-'+String(n+1).padStart(12,'0'));
 const joined=invoices.join(', ');
 return {changes:{destination:'Jaíba - Espinosa',notes:'NF: '+joined},selected_document_ids:invoices.map((_,n)=>'note-'+n),
  audit_events:invoices.map((invoice_number,n)=>({fiscal_document_id:'note-'+n,previous_load_id:null,invoice_number,
   details:{source:'new_load_dialog',selected_document:{id:'note-'+n,invoice_number,recipient:'Cliente sintético',remitter:'Fornecedor',neighborhood:'Centro',city:'Jaíba',state:'MG'},
    auto_filled_fields:{invoice_number,client_name:'Cliente sintético',supplier:'Fornecedor',neighborhood:'Centro',destination:'Centro - Jaíba - MG'},
    final_fields:{invoice_number:joined,client_name:'Cliente sintético',supplier:'Fornecedor',neighborhood:'Centro',destination:'Jaíba - Espinosa'}}}))};
};
const pending=(input=largeInput()):PendingLoadCreation=>({version:1,tenant:'tenant',actor:'actor',kind:'documents',scope:'manual',payload:{...input,tenant_id:'tenant',request_id:'request-1'}});
const confirmed=(payload:PendingLoadCreation['payload'])=>({data:{ok:true,load_id:'load-1',request_id:payload.request_id,tenant_id:payload.tenant_id,document_count:(payload.selected_document_ids as string[]).length,document_ids:payload.selected_document_ids,load:{id:'load-1',load_number:'M3'},replayed:true},error:null});
const setup=(storage=localStorage)=>{
 const send=vi.fn(async(_kind:string,payload:PendingLoadCreation['payload'])=>confirmed(payload));
 const deps={storage,send,uuid:vi.fn(()=>'request-1'),assertContext:vi.fn(),lock:async<T>(_key:string,work:()=>Promise<T>)=>work()};
 return {deps,submit:createLoadCreationOutbox(deps)};
};
beforeEach(()=>localStorage.clear());

it('reproduces the quota with 503 full audit events and stores a lossless smaller command before sending',async()=>{
 const input=largeInput(),row=pending(input),legacy=JSON.stringify(row);
 expect(legacy.length).toBeGreaterThan(6_500_000);
 expect(()=>localStorage.setItem(key,legacy)).toThrow(/quota/i);
 expect(localStorage.length).toBe(0);
 const {deps,submit}=setup();deps.send.mockRejectedValueOnce(new Error('offline'));
 await expect(submit('tenant','actor','documents','manual',input)).rejects.toThrow('sem confirmação');
 const stored=localStorage.getItem(key)!;
 expect(stored.length).toBeLessThan(500_000);expect(JSON.parse(stored).version).toBe(2);
 const decoded=readPendingLoadCreations(localStorage,'tenant','actor','documents')[0];
 expect(JSON.stringify(decoded)).toBe(legacy);
 expect(JSON.stringify(deps.send.mock.calls[0][1])).toBe(JSON.stringify(row.payload));
 expect(decoded.payload.selected_document_ids).toHaveLength(503);expect(decoded.payload.audit_events).toHaveLength(503);
 await createLoadCreationOutbox(deps)('tenant','actor','documents','manual');
 expect(deps.send.mock.calls[1][1]).toEqual(deps.send.mock.calls[0][1]);expect(deps.uuid).toHaveBeenCalledTimes(1);expect(localStorage.length).toBe(0);
});

it('retains an ordinary v1 pending command and its original request on recovery',async()=>{
 const row=pending({changes:{destination:'Salinas'},selected_document_ids:['note-1']});localStorage.setItem(key,JSON.stringify(row));
 const {deps,submit}=setup();await submit('tenant','actor','documents','manual');
 expect(deps.send.mock.calls[0][1]).toEqual(row.payload);expect(deps.uuid).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
});

it('does not rewrite or remove a pending v2 command when the caller changes the selection or audit',async()=>{
 const input=largeInput(),row=pending(input),serialized=serializeLoadCreation(row);localStorage.setItem(key,serialized);
 const {deps,submit}=setup();await expect(submit('tenant','actor','documents','manual',{...input,selected_document_ids:['other']})).rejects.toThrow('Recuperar criação');
 await expect(submit('tenant','actor','documents','manual',{...input,audit_events:[]})).rejects.toThrow('Recuperar criação');
 expect(deps.send).not.toHaveBeenCalled();expect(deps.uuid).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe(serialized);
});

it('still refuses to send if even the compact command exceeds remaining storage quota',async()=>{
 const filler='x'.repeat(4_999_000);localStorage.setItem('unrelated',filler);const {deps,submit}=setup();
 await expect(submit('tenant','actor','documents','manual',largeInput())).rejects.toThrow(/quota/i);
 expect(deps.send).not.toHaveBeenCalled();expect(localStorage.getItem('unrelated')).toBe(filler);expect(localStorage.getItem(key)).toBeNull();
});

it('fails before RPC when storage access is denied and preserves other pending requests',async()=>{
 localStorage.setItem('unrelated','keep');const storage:Storage={length:0,key:()=>null,getItem:()=>null,clear:()=>{throw Error('blocked');},removeItem:()=>{throw Error('blocked');},setItem:()=>{throw new DOMException('Storage disabled','SecurityError');}};
 const {deps,submit}=setup(storage);await expect(submit('tenant','actor','documents','manual',largeInput())).rejects.toThrow('Storage disabled');expect(deps.send).not.toHaveBeenCalled();expect(localStorage.getItem('unrelated')).toBe('keep');
});

it('fails before RPC if the exact stored bytes cannot be read back',async()=>{
 let stored:string|null=null;const storage:Storage={get length(){return stored===null?0:1;},key:()=>key,getItem:()=>stored&&stored+' ',setItem:(_key,value)=>{stored=value;},removeItem:()=>{stored=null;},clear:()=>{stored=null;}};
 const {deps,submit}=setup(storage);await expect(submit('tenant','actor','documents','manual',largeInput())).rejects.toThrow('salvar o pedido');expect(deps.send).not.toHaveBeenCalled();expect(stored).not.toBeNull();
});

it('preserves an uncertain command across reload and a definitive error on recovery',async()=>{
 const {deps,submit}=setup();deps.send.mockRejectedValueOnce(new Error('offline'));
 await expect(submit('tenant','actor','documents','manual',largeInput())).rejects.toThrow('sem confirmação');const stored=localStorage.getItem(key);
 deps.send.mockResolvedValueOnce({data:null,error:{code:'23505',message:'request_payload_mismatch'}} as unknown as ReturnType<typeof confirmed>);
 await expect(createLoadCreationOutbox(deps)('tenant','actor','documents','manual')).rejects.toMatchObject({code:'23505'});expect(localStorage.getItem(key)).toBe(stored);expect(deps.uuid).toHaveBeenCalledTimes(1);
});

it('retains the command when confirmation has the correct count but different document IDs',async()=>{
 const {deps,submit}=setup();deps.send.mockImplementationOnce(async(_kind,payload)=>({data:{...confirmed(payload).data,document_ids:Array.from({length:503},(_,n)=>'wrong-'+n)},error:null}));
 await expect(submit('tenant','actor','documents','manual',largeInput())).rejects.toThrow('confirmação compatível');expect(readPendingLoadCreations(localStorage,'tenant','actor','documents')[0].payload.selected_document_ids).toHaveLength(503);
});

it('keeps the pending command if successful confirmation cannot be removed from storage',async()=>{
 const storage:Storage={get length(){return localStorage.length;},key:n=>localStorage.key(n),getItem:name=>localStorage.getItem(name),setItem:(name,value)=>localStorage.setItem(name,value),removeItem:()=>{throw Error('blocked cleanup');},clear:()=>localStorage.clear()};
 const {deps,submit}=setup(storage);await expect(submit('tenant','actor','documents','manual',largeInput())).rejects.toThrow('blocked cleanup');expect(deps.send).toHaveBeenCalledTimes(1);expect(readPendingLoadCreations(localStorage,'tenant','actor','documents')).toHaveLength(1);
 await createLoadCreationOutbox({...deps,storage:localStorage})('tenant','actor','documents','manual');expect(deps.uuid).toHaveBeenCalledTimes(1);expect(localStorage.length).toBe(0);
});

it('isolates compact pending commands by actor, tenant, scope and kind',async()=>{
 localStorage.setItem(key,serializeLoadCreation(pending()));expect(readPendingLoadCreations(localStorage,'other','actor','documents')).toEqual([]);expect(readPendingLoadCreations(localStorage,'tenant','other','documents')).toEqual([]);expect(readPendingLoadCreations(localStorage,'tenant','actor','grouped')).toEqual([]);
 const foreign='agvlog:load-creation:v1:other:actor:documents:manual';localStorage.setItem(foreign,localStorage.getItem(key)!);
 const {deps,submit}=setup();await expect(submit('other','actor','documents','manual')).rejects.toThrow('criação pendente');expect(deps.send).not.toHaveBeenCalled();expect(localStorage.getItem(key)).not.toBeNull();
});

it('preserves marker-shaped user data, nested arrays, Unicode, nulls and prototype-named fields',()=>{
 const repeated='ação 🚚'.repeat(100),row={version:1,data:JSON.parse('{"__proto__":{"ref":0},"object":[["ref",0]],"array":[null,false,0,"literal"]}'),repeated:[repeated,repeated],empty:{}};
 const encoded=serializeLoadCreation(row),decoded=deserializeLoadCreation(JSON.parse(encoded));expect(JSON.stringify(decoded)).toBe(JSON.stringify(row));expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);expect({}).not.toHaveProperty('ref');
});

it.each(['index','duplicate-key','unknown-tag','unknown-codec','duplicate-string','extra-envelope-field'])('rejects %s corruption without sending or deleting the pending record',async defect=>{
 const envelope=JSON.parse(serializeLoadCreation(pending()));
 if(defect==='index')envelope.row={ref:999999};
 if(defect==='duplicate-key')envelope.row={object:[['version',1],['version',1]]};
 if(defect==='unknown-tag')envelope.row={other:0};
 if(defect==='unknown-codec')envelope.codec='other';
 if(defect==='duplicate-string')envelope.strings.push(envelope.strings[0]);
 if(defect==='extra-envelope-field')envelope.extra=true;
 const stored=JSON.stringify(envelope);localStorage.setItem(key,stored);const {deps,submit}=setup();
 await expect(submit('tenant','actor','documents','manual')).rejects.toThrow('criação pendente');expect(deps.send).not.toHaveBeenCalled();expect(deps.uuid).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe(stored);
});

it('keeps small commands in v1 and only chooses v2 when its complete envelope is smaller',()=>{
 const row=pending({changes:{destination:'Salinas'},selected_document_ids:['note-1']});expect(serializeLoadCreation(row)).toBe(JSON.stringify(row));
 const repeated='x'.repeat(128);const near={version:1,a:repeated,b:repeated};expect(serializeLoadCreation(near).length).toBeLessThanOrEqual(JSON.stringify(near).length);expect(deserializeLoadCreation(JSON.parse(serializeLoadCreation(near)))).toEqual(near);
});
