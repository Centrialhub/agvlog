import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,expect,it,vi} from 'vitest';
import DeliveryReceipts from '@/pages/DeliveryReceipts';

const mocks=vi.hoisted(()=>({list:vi.fn(),all:vi.fn(),catalog:vi.fn(),operations:vi.fn(),history:vi.fn(),ocrHealth:vi.fn(),ocrSearch:vi.fn()}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'20000000-0000-4000-8000-000000000001'},currentRole:'operator'})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'10000000-0000-4000-8000-000000000001'}})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('@/components/delivery-receipts/DeliveryReceiptSupplierChannels',()=>({DeliveryReceiptSupplierChannels:()=>null}));
vi.mock('@/components/delivery-receipts/DeliveryReceiptQualityPolicyPanel',()=>({DeliveryReceiptQualityPolicyPanel:()=>null}));
vi.mock('@/lib/deliveryReceipts/deliveryReceiptOperations',async importOriginal=>{
  const original=await importOriginal<typeof import('@/lib/deliveryReceipts/deliveryReceiptOperations')>();
  return {...original,listDeliveryReceipts:mocks.list,listAllDeliveryReceipts:mocks.all,getDeliveryReceiptFilterCatalog:mocks.catalog};
});
vi.mock('@/lib/deliveryReceipts/deliveryReceiptOperationsDashboard',async importOriginal=>{
  const original=await importOriginal<typeof import('@/lib/deliveryReceipts/deliveryReceiptOperationsDashboard')>();
  return {...original,getDeliveryReceiptOperations:mocks.operations,listDeliveryReceiptEmailHistory:mocks.history,
    getDeliveryReceiptOcrHealth:mocks.ocrHealth,searchDeliveryReceiptOcr:mocks.ocrSearch};
});

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.list.mockImplementation((_tenant:string,_actor:string,_filters:unknown,pagination:{limit:number;offset:number})=>Promise.resolve({
    version:1,tenant_id:'20000000-0000-4000-8000-000000000001',actor_id:'10000000-0000-4000-8000-000000000001',rows:[],
    total:82,limit:pagination.limit,offset:pagination.offset,
  }));
  mocks.catalog.mockResolvedValue({total:82,queues:{awaiting_sync:2,awaiting_validation:3,rejected:4,validated:20,physical_pending:5,
    ready_to_send:6,sent:30,send_failures:7},drivers:[{value:'driver-zulu',label:'Motorista fora da página'}],vehicles:[],suppliers:[],trips:[],loads:[],clients:[],cities:[],states:[]});
  mocks.operations.mockResolvedValue({receipts:{},emails:{},expenses:{},templates:[],batches:[]});
  mocks.all.mockResolvedValue([]);
  mocks.history.mockResolvedValue({rows:[],total:0,limit:25,offset:0});
  mocks.ocrHealth.mockResolvedValue({queued:0,processing:0,completed:0,unavailable:0,low_confidence:0});
  mocks.ocrSearch.mockResolvedValue([]);
});

it('shows the eight operational queues, complete filter catalog and server pagination',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><DeliveryReceipts/></QueryClientProvider>);
  const queues=(await screen.findByRole('heading',{name:'Filas operacionais'})).closest('section')!;
  for(const label of ['Aguardando sincronização','Aguardando validação','Rejeitados','Validados','Papel físico pendente','Prontos para envio','Enviados','Falhas de envio']){
    expect(within(queues).getByText(label)).toBeInTheDocument();
  }
  expect(await screen.findByRole('option',{name:'Motorista fora da página'})).toBeInTheDocument();
  expect(screen.getByText('Exibindo 0–0 de 82 canhotos')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Próxima'}));
  await waitFor(()=>expect(mocks.list).toHaveBeenCalledWith(expect.any(String),expect.any(String),{},
    {limit:25,offset:25},expect.any(AbortSignal)));
  expect(await screen.findByText('Página 2 de 4')).toBeInTheDocument();
});

const makeReceipt=(index:number)=>({
  id:`30000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,delivery_event_id:`31000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,
  trip_id:'80000000-0000-4000-8000-000000000001',stop_id:`82000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,
  delivered_at:'2026-09-10T15:00:00.000Z',captured_at:'2026-09-10T15:00:00.000Z',digital_status:'validated',physical_status:'received',
  email_status:'not_sent',scan_mode:'document_scan',has_original:true,has_processed:true,has_pdf:true,receiver_name:'Recebedor',driver:null,vehicle:null,
  client:null,load_ids:[],destination:'Destino',documents:[{id:`90000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,kind:'nfe',number:`NF-${index+1}`,
    series:null,access_key:null,issue_date:null,issuer_name:'Fornecedor QA',issuer_tax_id:'00123456000100',recipient_name:null,supplier_id:null,operational_reference:null}],
  updated_at:'2026-09-10T15:00:00.000Z',
});

it('selects every eligible supplier receipt across all filtered pages',async()=>{
  const rows=Array.from({length:30},(_,index)=>makeReceipt(index));
  mocks.list.mockImplementation((_tenant:string,_actor:string,_filters:unknown,pagination:{limit:number;offset:number})=>Promise.resolve({
    version:1,tenant_id:'20000000-0000-4000-8000-000000000001',actor_id:'10000000-0000-4000-8000-000000000001',
    rows:rows.slice(pagination.offset,pagination.offset+pagination.limit),total:rows.length,limit:pagination.limit,offset:pagination.offset,
  }));
  mocks.all.mockResolvedValue(rows);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><DeliveryReceipts/></QueryClientProvider>);
  const selector=await screen.findByRole('checkbox',{name:'Selecionar todos os 30 PDFs validados deste fornecedor no filtro atual'});
  expect(selector).toBeEnabled();
  expect(selector).not.toBeChecked();
  fireEvent.click(selector);
  expect(selector).toBeChecked();
  await waitFor(()=>expect(screen.getByText(/Preparar e-mail/)).toHaveTextContent('Preparar e-mail (30)'));
  expect(screen.getAllByLabelText(/Selecionar canhoto da entrega/)).toHaveLength(25);
});

it('pages and searches email history and prepares a bounced resend from its immutable snapshot',async()=>{
  const receipt='30000000-0000-4000-8000-000000000099',batch='40000000-0000-4000-8000-000000000001';
  mocks.history.mockImplementation((_tenant:string,_actor:string,input:{search:string;offset:number})=>Promise.resolve({rows:input.offset===0?[{
    id:batch,supplier_key:'tax:00123456000100',supplier_name:'Fornecedor histórico',receipt_ids:[receipt],recipients:['fiscal@fornecedor.test'],
    subject:'Canhoto NF-999',body_text:'Segue comprovante.',cover_config:{enabled:true,title:'Comprovante de entrega',subtitle:null,footer:null,
      fields:['delivery_date','destination','driver','vehicle','receiver','documents']},status:'bounced',attempt_count:1,last_error:null,retry_after_at:null,
    created_at:'2026-09-10T15:00:00.000Z',updated_at:'2026-09-10T15:00:00.000Z',sent_at:'2026-09-10T15:00:00.000Z',delivered_at:null,
    bounced_at:'2026-09-10T15:05:00.000Z',items:[{receipt_id:receipt,file_name:'CANHOTO_FORNECEDOR_NF-999.pdf',documents:[{kind:'nfe',number:'NF-999'}]}],
  }]:[],total:26,limit:25,offset:input.offset}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><DeliveryReceipts/></QueryClientProvider>);
  await userEvent.type(await screen.findByRole('textbox',{name:'Pesquisar histórico de lotes'}),'NF-999');
  await waitFor(()=>expect(mocks.history).toHaveBeenLastCalledWith(expect.any(String),expect.any(String),
    expect.objectContaining({search:'NF-999',offset:0}),expect.any(AbortSignal)));
  await userEvent.click(await screen.findByRole('button',{name:'Preparar novo envio'}));
  expect(screen.getByText(/CANHOTO_FORNECEDOR_NF-999.pdf/)).toBeInTheDocument();
  expect(screen.getByDisplayValue('fiscal@fornecedor.test')).toBeInTheDocument();
  const historyNav=screen.getByRole('navigation',{name:'Paginação do histórico de lotes'});
  await userEvent.click(within(historyNav).getByRole('button',{name:'Próxima'}));
  await waitFor(()=>expect(mocks.history).toHaveBeenLastCalledWith(expect.any(String),expect.any(String),
    expect.objectContaining({search:'NF-999',offset:25}),expect.any(AbortSignal)));
});
