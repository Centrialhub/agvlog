import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import {readReceiptRecognitions,type ReceiptRecognitionReading} from '@/lib/deliveryReceipts/receiptRecognition';
import {ReceiptRecognitionPanel} from '@/components/delivery-receipts/ReceiptRecognitionPanel';
const m=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:m.rpc}}));
const tenant='20000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000001',id='30000000-0000-4000-8000-000000000001';
const reading:ReceiptRecognitionReading={receipt_id:id,status:'completed',text:'Recebido em 09/11/2026',date_text:'09/11/2026',delivery_date:'2026-11-09',date_confidence:0.95,
 signature_presence:'present',signature_confidence:0.96,needs_review:false,error_code:null,updated_at:'2026-11-10T15:00:00Z'};
beforeEach(()=>{vi.clearAllMocks();m.rpc.mockReturnValue({abortSignal:async()=>({data:{version:1,tenant_id:tenant,actor_id:actor,rows:[reading]},error:null})});});
afterEach(cleanup);
it('reads scoped results with the active session and selected receipt IDs',async()=>{
 expect(await readReceiptRecognitions(tenant,actor,[id],new AbortController().signal)).toEqual([reading]);
 expect(m.rpc).toHaveBeenCalledWith('get_delivery_receipt_ocr_readings_v1',{_tenant_id:tenant,_receipt_ids:[id]});
});
it('rejects foreign session or receipts instead of showing someone else’s result',async()=>{
 for(const data of [{version:1,tenant_id:tenant,actor_id:id,rows:[reading]},
  {version:1,tenant_id:tenant,actor_id:actor,rows:[{...reading,receipt_id:actor}]}]){
  m.rpc.mockReturnValueOnce({abortSignal:async()=>({data,error:null})});
  await expect(readReceiptRecognitions(tenant,actor,[id],new AbortController().signal)).rejects.toThrow('sessão atual');
 }
});
it('shows the written date separately from delivery time without authenticating a signature',()=>{
 render(<ReceiptRecognitionPanel reading={reading} loading={false} error={false}/>);
 expect(screen.getByText('Data escrita no canhoto:').parentElement).toHaveTextContent('09/11/2026');expect(screen.getByText('Assinatura visível no canhoto')).toBeInTheDocument();
 expect(screen.getByText(/não autentica o signatário/)).toBeInTheDocument();
});
it('inconclusive writing/signature remains explicitly pending review',()=>{
 render(<ReceiptRecognitionPanel reading={{...reading,delivery_date:null,date_text:'09/11',signature_presence:'uncertain',needs_review:true}} loading={false} error={false}/>);
 expect(screen.getByText(/Não identificada com segurança/)).toBeInTheDocument();expect(screen.getByText('Assinatura inconclusiva')).toBeInTheDocument();
 expect(screen.getByText(/precisa de revisão/)).toBeInTheDocument();
});
