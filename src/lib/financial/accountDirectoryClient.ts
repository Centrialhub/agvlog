import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
const row=z.object({id:z.string().uuid(),tenant_id:z.string().uuid(),name:z.string(),account_type:z.enum(['checking','savings','cash','company_card','pix','other']),active:z.boolean()});
export async function readAccountDirectory(tenant:string,search:string,page:number){
 if(!Number.isInteger(page)||page<1)throw new Error('Página inválida.');
 let query=supabase.from('bank_accounts').select('id,tenant_id,name,account_type,active',{count:'exact'}).eq('tenant_id',tenant);
 if(search.trim())query=query.ilike('name',`%${search.trim().replace(/[\\%_]/g,'\\$&')}%`);
 const {data,error,count}=await query.order('name').order('id').range((page-1)*20,page*20-1);
 if(error)throw error;
 const rows=z.array(row).parse(data);
 if(count===null||rows.some(account=>account.tenant_id!==tenant))throw new Error('Cadastro fora do contexto esperado.');
 return {rows,total:count,page,page_size:20};
}
