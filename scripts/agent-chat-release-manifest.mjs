import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const agentChatMigration='20261124194200_driver_agent_chat_threads.sql';
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyAgentChatRelease({root,forwardFiles,entries}){
 let text;
 try{text=await readFile(resolve(root,'docs/qa/agent-chat-release-manifest.json'),'utf8');}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 const m=JSON.parse(text);
 if(Object.keys(m).length!==5||m.formatVersion!==1||m.purpose!=='agvlog-agent-chat-only'
  ||m.filename!==agentChatMigration||!forwardFiles.includes(agentChatMigration)
  ||!entries.find(e=>e.name===agentChatMigration)?.isFile())throw new Error('Agent chat release identity invalid');
 const sql=await readFile(resolve(root,'supabase/migrations',agentChatMigration));
 const previous=(await readFile(resolve(root,'docs/qa/quick-cargo-release-manifest.json'),'utf8')).replace(/\r\n/g,'\n');
 if(sql.includes('\r\n')||hash(sql)!==m.sha256||hash(previous)!==m.preservedQuickCargoManifestSha256)
  throw new Error('Agent chat release bytes changed');
 return {filename:agentChatMigration,sha256:m.sha256};
}
