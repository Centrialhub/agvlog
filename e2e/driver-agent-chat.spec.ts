import {expect,test,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {accounts,fixtureIds} from './fixtures/accounts';
import {loginThroughUi,passwordToken} from './fixtures/session';

async function send(page:Page,message:string){
 await page.getByRole('textbox',{name:'Mensagem',exact:true}).fill(message);
 await expect(page.getByRole('button',{name:'Enviar mensagem',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Enviar mensagem',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Mensagem registrada no servidor. Isso não confirma a leitura.'})).toBeVisible();
}
function receivedLiveMessages(page:Page){
 const messages=new Set<string>();
 page.on('websocket',socket=>socket.on('framereceived',frame=>{
  try{
   const parsed=JSON.parse(frame.payload.toString());
   const event=Array.isArray(parsed)?parsed[3]:parsed.event,payload=Array.isArray(parsed)?parsed[4]:parsed.payload;
   if(event==='postgres_changes'&&payload?.data?.table==='driver_direct_messages'&&typeof payload.data.record?.message==='string')messages.add(payload.data.record.message);
  }catch{/* Ignore protocol frames that are not database-change JSON. Never log authentication frames. */}
 }));return messages;
}
test('@critical driver selects agents and exchanges live private messages with an operational browser',async({page,browser,request},info)=>{
 test.setTimeout(90000);
 // This new write scenario is approved only for the existing disposable loopback fixture.
 expect(new URL(process.env.VITE_SUPABASE_URL??'').origin).toBe('http://127.0.0.1:55321');
 const driverFrames=receivedLiveMessages(page);
 await loginThroughUi(page,accounts.driver);
 expect(['127.0.0.1','localhost']).toContain(new URL(page.url()).hostname);
 const operation=await browser.newContext({baseURL:new URL(page.url()).origin,viewport:page.viewportSize(),
  isMobile:Boolean(info.project.use.isMobile),hasTouch:Boolean(info.project.use.hasTouch),locale:'pt-BR',timezoneId:'America/Sao_Paulo'});
 try{
  const staff=await operation.newPage(),staffFrames=receivedLiveMessages(staff);await loginThroughUi(staff,accounts.operator);
  await Promise.all([page.goto('/driver/chat'),staff.goto('/driver-chat')]);
  await staff.getByLabel('Iniciar conversa com motorista',{exact:true}).selectOption('60000000-0000-4000-8000-000000000001');
  await page.getByRole('complementary',{name:'Atendentes'}).getByRole('button',{name:/^Operator E2E\s/}).click();
  await Promise.all([expect(page.getByText('Conexão ao vivo ativa',{exact:true})).toBeVisible(),expect(staff.getByText('Conexão ao vivo ativa',{exact:true})).toBeVisible()]);
  const nonce=`QA-${Date.now()}-${info.project.name}`,question=`Motorista para operador ${nonce}`,answer=`Operador para motorista ${nonce}`;
  await send(page,question);
  // Both room queries have just started their 15s timers: the 8s response requires live delivery, not manual refresh.
  await expect(staff.getByRole('log').getByText(question,{exact:true})).toBeVisible({timeout:8000});
  await expect.poll(()=>staffFrames.has(question),{timeout:8000}).toBe(true);
  await send(staff,answer);await expect(page.getByRole('log').getByText(answer,{exact:true})).toBeVisible({timeout:8000});
  await expect.poll(()=>driverFrames.has(answer),{timeout:8000}).toBe(true);
  for(const current of [page,staff]){
   const accessibility=await new AxeBuilder({page:current}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
   expect(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact??''))).toEqual([]);
  }
  await page.getByRole('textbox',{name:'Mensagem',exact:true}).fill('Rascunho exclusivo do operador');
  await page.getByRole('complementary',{name:'Atendentes'}).getByRole('button',{name:/^Admin E2E\s/}).click();
  await expect(page.getByRole('textbox',{name:'Mensagem',exact:true})).toHaveValue('');
  const other=`Somente administração ${nonce}`;await send(page,other);
  await page.getByRole('navigation',{name:'Conversas abertas'}).getByRole('button',{name:'Operator E2E',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Mensagem',exact:true})).toHaveValue('Rascunho exclusivo do operador');
  await expect(page.getByRole('log').getByText(other,{exact:true})).toHaveCount(0);
  const session=await passwordToken(request,accounts.operator);
  const response=await request.get(`${session.backendUrl}/rest/v1/driver_direct_messages?agent_user_id=eq.10000000-0000-4000-8000-000000000006&message=eq.${encodeURIComponent(other)}&select=id`,
   {headers:{apikey:session.publishableKey,Authorization:`Bearer ${session.accessToken}`,'x-agvlog-tenant-id':fixtureIds.tenantA}});
  expect(response.ok(),await response.text()).toBeTruthy();expect(await response.json()).toEqual([]);
  expect(staffFrames.has(other)).toBe(false);
  await page.reload();await page.getByRole('complementary',{name:'Atendentes'}).getByRole('button',{name:/^Operator E2E\s/}).click();
  await expect(page.getByRole('log').getByText(answer,{exact:true})).toBeVisible();
  await staff.getByRole('button',{name:'Operação geral / histórico',exact:true}).click();
  await staff.getByLabel('Motorista',{exact:true}).selectOption('60000000-0000-4000-8000-000000000001');
  await expect(staff.getByRole('log')).toBeVisible();await expect(staff.getByRole('log').getByText(question,{exact:true})).toHaveCount(0);
 }finally{await operation.close();}
});
