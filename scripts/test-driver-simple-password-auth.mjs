// Run LAST on the disposable seven-user CI stack; it changes only the synthetic driver login.
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {handleWorkspaceCredentialCommand} from '../supabase/functions/manage-driver-access/workspace-credentials.ts';
const origin=process.env.VITE_SUPABASE_URL;
if(origin!=='http://127.0.0.1:55321'||process.env.CI!=='true')throw Error('Disposable loopback CI stack required');
const key=process.env.E2E_LOCAL_STORAGE_SERVICE_KEY;
const anon=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(!key||!anon)throw Error('Isolated fixture credentials required');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(origin,key,options);
const tenantId='20000000-0000-4000-8000-000000000001',actorId='10000000-0000-4000-8000-000000000006';
const userId='10000000-0000-4000-8000-000000000003',driverId='60000000-0000-4000-8000-000000000001';
const {data:before,error}=await admin.auth.admin.getUserById(userId);
if(error||before.user?.email!=='driver@agvlog-e2e.invalid')throw Error('Untouched synthetic driver required');
const username='qa.simple.'+randomUUID().slice(0,8);
async function command(action,password){
 const result=await handleWorkspaceCredentialCommand(admin,{tenantId,actorId,userId,driverId,requestId:randomUUID(),action,username,password});
 if(result.status!==200||result.body.state!=='succeeded')throw Error('Native simple-password credential command failed: '+action);
}
async function login(password,expected){
 const client=createClient(origin,anon,options);
 const result=await client.auth.signInWithPassword({email:username+'@usuario.com',password});
 if(expected?(!!result.error||result.data.user?.id!==userId):!result.error)throw Error('Native simple-password login expectation failed');
 if(result.data.session)await client.auth.signOut();
}
await command('convert','xqztkv');await login('xqztkv',true);
await command('password','738291');await login('738291',true);await login('xqztkv',false);
const short=await handleWorkspaceCredentialCommand(admin,{tenantId,actorId,userId,driverId,requestId:randomUUID(),action:'password',password:'abcde'});
if(short.status!==400)throw Error('Short password accepted');
await login('738291',true);
console.log('Native Auth passed: six letters, six digits, audited conversion/reset, real login, old-password rejection and short-password rejection.');
