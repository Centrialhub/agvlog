import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build} from 'vite';
import react from '@vitejs/plugin-react-swc';
import {chromium} from 'playwright';
import {createOperationalDriverChatDatabase} from '../src/test/helpers/operationalDriverChatDatabase.ts';
import {chatActor,chatIds as i} from '../src/test/helpers/driverChatDatabase.ts';
import {operationRpc} from '../src/test/helpers/operationOutcomeDatabase.ts';

const root=process.cwd(),cache=path.resolve('node_modules/.cache/qa-operational-chat'),fixture=path.join(cache,String(Date.now()));
fs.mkdirSync(fixture,{recursive:true});
const db=await createOperationalDriverChatDatabase(),requests=[],steps=[],contexts=[],browserErrors=[];
const knownActors=new Set([i.user,i.peerUser,i.foreignUser,i.operator,i.admin,i.client]);
let queue=Promise.resolve(),dist=path.join(fixture,'dist');
const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
async function rpc(req,res){
 let raw='';for await(const chunk of req)raw+=chunk;const args=JSON.parse(raw||'{}'),actor=req.headers['x-qa-actor'];
 if(!knownActors.has(actor))return reply(res,403,{code:'42501',message:'Fixture actor missing'});
 const name=new URL(req.url,'http://localhost').pathname.split('/').at(-1);requests.push({name,actor,tenant:args._tenant_id??args._payload?.tenant_id});
 const task=async()=>{try{
  await db.exec('begin');await chatActor(db,actor);let sql,params;
  if(name==='list_operator_reference_page_v1'){sql='select list_operator_reference_page_v1($1,$2,$3,$4,$5::jsonb) r';params=[args._tenant_id,args._resource,args._include_inactive,args._limit,args._cursor == null ? null : JSON.stringify(args._cursor)];}
  else if(name==='get_driver_chat_context'){sql='select get_driver_chat_context($1,$2) r';params=[args._tenant_id,args._driver_id];}
  else if(name==='list_driver_chat_messages'){sql='select list_driver_chat_messages($1,$2,$3::jsonb) r';params=[args._tenant_id,args._driver_id,JSON.stringify(args._before??null)];}
  else if(name==='send_driver_chat_message'){sql='select send_driver_chat_message($1::jsonb) r';params=[JSON.stringify(args._payload)];}
  else throw Error('Unexpected fixture RPC '+name);
  const data=(await operationRpc(db,sql,params)).rows[0].r;await db.exec('commit');reply(res,200,data);
 }catch(error){await db.exec('rollback').catch(()=>{});reply(res,error.code==='42501'?403:400,{code:error.code??'QA',message:error.message});}};
 queue=queue.then(task,task);await queue;
}
const server=http.createServer(async(req,res)=>{try{
 if(req.method==='POST'&&req.url.startsWith('/rest/v1/rpc/'))return await rpc(req,res);
 const url=new URL(req.url,'http://localhost'),file=url.pathname.startsWith('/assets/')?path.join(dist,url.pathname):path.join(dist,'index.html');
 if(!file.startsWith(dist)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
 res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(fs.readFileSync(file));
 }catch(error){reply(res,500,{message:error.message});}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const identities={driver:{actor:i.user,role:'driver',tenant:i.tenant},operation:{actor:i.operator,role:'operator',tenant:i.tenant},client:{actor:i.client,role:'client',tenant:i.tenant},foreignTenant:{actor:i.operator,role:'operator',tenant:i.otherTenant},forgedClient:{actor:i.client,role:'operator',tenant:i.tenant}};
const write=(name,text)=>fs.writeFileSync(path.join(fixture,name),text);
write('state.tsx',`import React,{createContext,useContext,useState} from 'react';
const identities=${JSON.stringify(identities)},Context=createContext(null);
export function FixtureProvider({children}){const [identity,setIdentity]=useState(()=>JSON.parse(localStorage.getItem('qa-chat-identity')||'null')||identities.operation);const change=name=>{const next=identities[name];localStorage.setItem('qa-chat-identity',JSON.stringify(next));setIdentity(next);};return <Context.Provider value={identity}><label htmlFor="qa-identity">Identidade sintética QA</label><select id="qa-identity" value={Object.keys(identities).find(key=>JSON.stringify(identities[key])===JSON.stringify(identity))} onChange={event=>change(event.target.value)}>{Object.keys(identities).map(name=><option key={name}>{name}</option>)}</select>{children}</Context.Provider>;}
export const useFixture=()=>useContext(Context);`);
write('auth.tsx',`import {useFixture} from './state';export const useAuth=()=>({user:{id:useFixture().actor},loading:false});`);
write('tenant.tsx',`import {useFixture} from './state';export const TenantProvider=({children})=>children;export function useTenant(){const s=useFixture();return {currentTenant:{id:s.tenant},currentRole:s.role,loading:false};}export const useIsAdmin=()=>['owner','admin'].includes(useFixture().role);`);
write('driver.tsx',`import {useFixture} from './state';export const useCurrentDriver=()=>({data:{id:useFixture().actor===${JSON.stringify(i.user)}?${JSON.stringify(i.driver)}:${JSON.stringify(i.foreignDriver)},name:'Motorista QA'},isPending:false,error:null});`);
write('client.ts',`import {createClient} from '@supabase/supabase-js';export const supabase=createClient(${JSON.stringify(origin)},'sb_publishable_qa_placeholder',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>{const state=JSON.parse(localStorage.getItem('qa-chat-identity')||'null')||${JSON.stringify(identities.operation)},headers=new Headers(init?.headers);headers.set('x-qa-actor',state.actor);return fetch(input,{...init,headers});}}});`);
write('layout.tsx',`import {SidebarNavigation} from '@/components/layout/SidebarNavigation';import {TooltipProvider} from '@/components/ui/tooltip';export default function Layout({children}){return <TooltipProvider><SidebarNavigation query="chat" capabilityAvailable={()=>true}/><main>{children}</main></TooltipProvider>;}`);
write('driver-layout.tsx',`export default function Layout({children}){return <main>{children}</main>;}`);
write('index.html','<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
write('main.tsx',`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {FixtureProvider} from './state';import {ProtectedRoute,DriverRoute} from '@/app/routeGuards';import OperationalDriverChat from '@/pages/OperationalDriverChat';import DriverChat from '@/pages/driver/DriverChat';const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});createRoot(document.getElementById('root')).render(<FixtureProvider><QueryClientProvider client={client}><BrowserRouter><Routes><Route path="/driver-chat" element={<ProtectedRoute roles={['owner','admin','operator']}><OperationalDriverChat/></ProtectedRoute>}/><Route path="/driver" element={<DriverRoute><DriverChat/></DriverRoute>}/><Route path="/" element={<ProtectedRoute><p>Início da fixture</p></ProtectedRoute>}/><Route path="/portal" element={<p>Portal da fixture</p>}/><Route path="/auth" element={<p>Autenticação sintética ausente</p>}/></Routes></BrowserRouter></QueryClientProvider></FixtureProvider>);`);
const replacements=[[/\/hooks\/useAuth(?:\.tsx)?$/,'auth.tsx'],[/\/hooks\/useTenant(?:\.tsx)?$/,'tenant.tsx'],[/\/hooks\/useCurrentDriver(?:\.tsx)?$/,'driver.tsx'],[/\/integrations\/supabase\/client(?:\.ts)?$/,'client.ts'],[/\/components\/layout\/AppLayout(?:\.tsx)?$/,'layout.tsx'],[/\/components\/layout\/DriverLayout(?:\.tsx)?$/,'driver-layout.tsx']];
const sha=execFileSync('git',['--no-optional-locks','-c','safe.directory='+root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),tree=execFileSync('git',['--no-optional-locks','-c','safe.directory='+root,'rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),clean=!execFileSync('git',['--no-optional-locks','-c','safe.directory='+root,'status','--porcelain=v1','--untracked-files=all'],{encoding:'utf8'}).trim();
const sourceFiles=['src/pages/OperationalDriverChat.tsx','src/app/AppRoutes.tsx','src/components/layout/navigation.ts','src/components/driver/DriverConversation.tsx','src/hooks/useDrivers.tsx','src/hooks/useDriverMessages.tsx','src/hooks/useDriverChatSend.ts','src/test/helpers/operationalDriverChatDatabase.ts','scripts/test-operational-driver-chat-browser.mjs'];
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const record={at:new Date().toISOString(),sha,tree,workingTreeClean:clean,sourceFilesSha256:Object.fromEntries(sourceFiles.map(file=>[file,digest(file)])),steps,scope:'Real page/menu/ProtectedRoute/DriverRoute/components and Supabase JS RPC -> isolated PGlite actual catalog/chat SQL with synthetic fixture identities; Auth/tenant hooks/claims and current-driver lookup supplied by fixture; realtime hosted Auth and native DB not validated',realMessagesSent:false,externalRequestsAllowed:false,sharedServicesTouched:false};
let browser;
try{
 await build({configFile:false,root:fixture,envFile:false,resolve:{alias:{'@':path.join(root,'src')}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(origin),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_qa_placeholder')},plugins:[{name:'synthetic-session-boundaries',enforce:'pre',resolveId(source,importer){let full=source.replaceAll('\\','/');if(source.startsWith('./')&&importer?.includes('/src/hooks/'))full='/hooks/'+source.slice(2);const replacement=replacements.find(([regex])=>regex.test(full));return replacement?path.join(fixture,replacement[1]):null;}},react()],build:{outDir:dist,emptyOutDir:true,minify:false,sourcemap:false,rollupOptions:{onwarn(warning,handler){if(warning.code!=='MODULE_LEVEL_DIRECTIVE')handler(warning);}}}});
 browser=await chromium.launch({headless:true});record.browser=browser.version();
 async function pageFor(identity,route){const context=await browser.newContext();contexts.push(context);await context.route(url=>url.origin!==origin,route=>route.abort());await context.addInitScript(({value})=>{if(!localStorage.getItem('qa-chat-identity'))localStorage.setItem('qa-chat-identity',JSON.stringify(value));},{value:identities[identity]});const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>browserErrors.push(String(error)));await page.goto(origin+route);return page;}
 async function selectDriver(page){await page.getByRole('option',{name:'Motorista QA',exact:true}).waitFor({state:'attached'});await page.getByLabel('Motorista',{exact:true}).selectOption(i.driver);await page.getByLabel('Mensagem',{exact:true}).waitFor();}
 async function send(page,text){await page.getByLabel('Mensagem',{exact:true}).fill(text);await page.getByRole('button',{name:'Enviar mensagem',exact:true}).click();await page.getByText('Mensagem registrada no servidor. Isso não confirma a leitura.',{exact:true}).waitFor();}
 assert.equal((await db.query("select to_regclass('public.operational_events') present")).rows[0].present,null);
 const driver=await pageFor('driver','/driver'),operation=await pageFor('operation','/');
 await send(driver,'Motorista iniciou conversa QA');await operation.getByRole('link',{name:'Chat com motoristas',exact:true}).click();await operation.getByRole('heading',{name:'Chat com motoristas',exact:true}).waitFor();await selectDriver(operation);await operation.getByText('Motorista iniciou conversa QA',{exact:true}).waitFor();await send(operation,'Operação respondeu QA');await driver.getByText('Operação respondeu QA',{exact:true}).waitFor({timeout:20000});
 steps.push({name:'Driver form -> operation menu/route without occurrences -> operation reply -> driver automatic polling',transport:'Actual Supabase JS RPC and actual catalog/chat SQL; synthetic session claims',rows:2});
 await operation.reload();await selectDriver(operation);await operation.getByText('Motorista iniciou conversa QA',{exact:true}).waitFor();await operation.getByText('Operação respondeu QA',{exact:true}).waitFor();await operation.getByRole('button',{name:'Atualizar conversa',exact:true}).click();await driver.reload();await driver.getByText('Operação respondeu QA',{exact:true}).waitFor();steps.push({name:'Both identities reload persisted history; explicit operation refresh preserves both messages'});
 await operation.getByLabel('Mensagem',{exact:true}).fill('Rascunho privado QA');await operation.getByLabel('Identidade sintética QA').selectOption('foreignTenant');await operation.getByText(/Não foi possível carregar os motoristas/).waitFor();assert.equal(await operation.getByLabel('Mensagem',{exact:true}).count(),0);await operation.getByLabel('Identidade sintética QA').selectOption('operation');await operation.getByRole('option',{name:'Motorista QA',exact:true}).waitFor({state:'attached'});assert.equal(await operation.getByLabel('Motorista',{exact:true}).inputValue(),'');await selectDriver(operation);assert.equal(await operation.getByLabel('Mensagem',{exact:true}).inputValue(),'');steps.push({name:'Tenant switch denies foreign catalog and resets selection/private draft on return'});
 await driver.goto(origin+'/driver-chat');await driver.waitForURL(origin+'/driver');assert.equal(await driver.getByRole('heading',{name:'Chat com motoristas',exact:true}).count(),0);
 const client=await pageFor('client','/driver-chat');await client.waitForURL(origin+'/portal');assert.equal(await client.getByRole('link',{name:'Chat com motoristas',exact:true}).count(),0);
 const forged=await pageFor('forgedClient','/driver-chat');await forged.getByText(/Não foi possível carregar os motoristas/).waitFor();assert.equal(await forged.getByLabel('Mensagem',{exact:true}).count(),0);steps.push({name:'Real route guard rejects driver/client; SQL rejects forged frontend client role'});
 async function denied(page,tenant,driverId){return page.evaluate(async({origin,tenant,driverId})=>{const actor=JSON.parse(localStorage.getItem('qa-chat-identity')).actor,response=await fetch(origin+'/rest/v1/rpc/list_driver_chat_messages',{method:'POST',headers:{'content-type':'application/json','x-qa-actor':actor},body:JSON.stringify({_tenant_id:tenant,_driver_id:driverId,_before:null})});return {status:response.status,error:await response.json()};},{origin,tenant,driverId});}
 for(const [page,tenant,driverId] of [[driver,i.otherTenant,i.foreignDriver],[client,i.tenant,i.driver],[operation,i.otherTenant,i.foreignDriver]]){const result=await denied(page,tenant,driverId);assert.equal(result.status,403);assert.equal(result.error.code,'42501');assert.match(result.error.message,/not_authorized/);}
 steps.push({name:'Direct actual SQL history access denied for another tenant and client role',negatives:3});
 await queue;const rows=(await db.query('select sender_id,sender_role,message from driver_direct_messages order by created_at,id')).rows;assert.deepEqual(rows,[{sender_id:i.user,sender_role:'driver',message:'Motorista iniciou conversa QA'},{sender_id:i.operator,sender_role:'operator',message:'Operação respondeu QA'}]);assert.equal(browserErrors.length,0);
 record.syntheticRows=rows;record.requests=requests;record.browserErrors=browserErrors;record.status=clean?'passed-local-browser':'passed-local-browser-draft';fs.writeFileSync(path.join(cache,'evidence.json'),JSON.stringify(record,null,2)+'\n');await operation.screenshot({path:path.join(cache,'operation-chat.png'),fullPage:true});console.log(JSON.stringify({sha,status:record.status,steps:steps.length,syntheticRows:rows.length,scope:record.scope}));
}catch(error){record.status='failed-local-browser';record.error=String(error);record.browserErrors=browserErrors;record.lastPages=[];for(const context of contexts)for(const page of context.pages())record.lastPages.push({url:page.url(),ui:await page.locator('body').innerText().catch(()=>null)});fs.writeFileSync(path.join(cache,'failed-evidence.json'),JSON.stringify(record,null,2)+'\n');throw error;}
finally{for(const context of contexts)await context.close().catch(()=>{});await browser?.close();await queue;await new Promise(resolve=>server.close(resolve));await db.close();}
