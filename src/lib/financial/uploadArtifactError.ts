const messages:Record<string,string>={
 tenant_context_mismatch:'A empresa da sessão mudou. Selecione novamente a empresa antes de recuperar o envio.',
 invalid_token:'A sessão expirou. Entre novamente para recuperar o envio.',
 finance_access_denied:'Esta sessão não tem acesso financeiro à empresa selecionada.',
 upload_rate_limited:'O limite temporário de envios foi atingido. Aguarde antes de recuperar o envio.',
 upload_invalid_request:'O arquivo ou os dados do envio não foram aceitos.',
 upload_gateway_not_configured:'O serviço de arquivos está indisponível por configuração.',
 ORIGIN_NOT_ALLOWED:'O endereço deste aplicativo não foi autorizado pelo serviço de arquivos.',
};
/** Only allowlisted codes leave the response; never echo server messages or file data. */
export async function uploadArtifactError(error:unknown):Promise<Error>{
 const context=error&&typeof error==='object'&&'context' in error?error.context:null;
 const response=typeof Response!=='undefined'&&context instanceof Response?context:null;
 let code:string|undefined;
 if(response){
  try{
   const body:unknown=await response.clone().json();
   if(body&&typeof body==='object'&&'error' in body){
    const value=body.error;
    const candidate=typeof value==='string'?value:value&&typeof value==='object'&&'code' in value?value.code:null;
    if(typeof candidate==='string'&&Object.prototype.hasOwnProperty.call(messages,candidate))code=candidate;
   }
  }catch{/* Empty, consumed and non-JSON responses retain the HTTP diagnostic. */}
 }
 const status=response&&response.status>=400?`HTTP ${response.status}`:null;
 const detail=code?messages[code]:response?.status===401?'A sessão não foi aceita pelo serviço de arquivos.':response?.status===403?'O serviço de arquivos negou acesso ao envio.':response?.status===429?'O limite temporário de envios foi atingido.':'Envio sem confirmação.';
 return new Error(`${detail}${code||status?` (${[status,code].filter(Boolean).join(' · ')})`:''} O pedido foi preservado; recupere com o mesmo arquivo.`);
}
