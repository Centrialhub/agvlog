import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const invoiceProductsMigration='20261124194623_invoice_product_items.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyInvoiceProductsRelease({root,forwardFiles,entries}){
 let text;
 try{text=await readFile(resolve(root,'docs/qa/invoice-products-release-manifest.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const m=JSON.parse(text);
 if(Object.keys(m).length!==5||m.formatVersion!==1||m.purpose!=='agvlog-invoice-products-only'
  ||m.filename!==invoiceProductsMigration||!forwardFiles.includes(invoiceProductsMigration)
  ||!entries.find(e=>e.name===invoiceProductsMigration)?.isFile())throw new Error('Invoice products release identity invalid');
 const sql=await readFile(resolve(root,'supabase/migrations',invoiceProductsMigration));
 const previous=(await readFile(resolve(root,'docs/qa/agent-chat-release-manifest.json'),'utf8')).replace(/\r\n/g,'\n');
 if(sql.includes('\r\n')||hash(sql)!==m.sha256||hash(previous)!==m.preservedAgentChatManifestSha256)
  throw new Error('Invoice products release bytes changed');
 return {filename:invoiceProductsMigration,sha256:m.sha256};
}
