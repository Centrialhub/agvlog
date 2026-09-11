export function statementFileType(name:string,bytes:Uint8Array):{extension:string;mime:string}|null {
  const extension=name.split('.').pop()?.toLowerCase();
  const starts=(signature:number[])=>signature.every((value,index)=>bytes[index]===value);
  if(extension==='ofx'){
    const prefix=new TextDecoder('windows-1252').decode(bytes.slice(starts([0xef,0xbb,0xbf])?3:0,2048));
    if(/<OFX>/i.test(prefix)&&/^\s*(?:OFXHEADER:100|<\?xml\s|<\?OFX\s|<OFX>)/i.test(prefix))return {extension,mime:'application/x-ofx'};
    return null;
  }
  if(extension==='xlsx'&&starts([0x50,0x4b,0x03,0x04]))return {extension,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
  if(extension==='xls'&&starts([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))return {extension,mime:'application/vnd.ms-excel'};
  if(extension==='csv'){
    try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(!text.trim()||bytes.some(byte=>byte<32&&![9,10,13].includes(byte))||!/[;,\t]/.test(text))return null;
      return {extension,mime:'text/csv'};
    }catch{return null;}
  }
  return null;
}
export async function originalHash(bytes:Uint8Array):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function preserveStatementOriginal(tenant:string,name:string,bytes:Uint8Array,deps:{
  upload:(path:string,bytes:Uint8Array,mime:string)=>Promise<{error:unknown}>;
  download:(path:string)=>Promise<Uint8Array|null>;
}){
  const type=statementFileType(name,bytes);
  if(!type||!bytes.length||bytes.length>10485760)throw new Error('finance_statement_file_invalid');
  const hash=await originalHash(bytes),path=`${tenant}/imports/${hash}.${type.extension}`;
  const {error}=await deps.upload(path,bytes,type.mime);
  if(error){
    const stored=await deps.download(path);
    if(!stored||stored.length!==bytes.length||await originalHash(stored)!==hash)throw new Error('finance_statement_storage_unconfirmed');
  }
  return {path,sha256:hash,size:bytes.length,content_type:type.mime};
}
