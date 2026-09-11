import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const mocks=vi.hoisted(()=>({read:vi.fn(),upload:vi.fn(),attach:vi.fn(),load:vi.fn()}));
vi.mock('@/lib/financial/expenseArtifactClient',()=>({readExpenseArtifacts:mocks.read,previewExpenseArtifact:vi.fn()}));
vi.mock('@/lib/financial/uploadArtifactRecovery',()=>({uploadRecoverableFinanceArtifact:mocks.upload}));
vi.mock('@/lib/financial/expenseArtifactOutbox',()=>({attachExpenseArtifact:mocks.attach,loadExpenseArtifactPending:mocks.load}));
import {ExpenseArtifactPanel} from '@/components/financial/ExpenseArtifactPanel';
const id='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{Object.values(mocks).forEach(m=>m.mockReset());mocks.read.mockResolvedValue({receipts:[]});mocks.load.mockReturnValue(null);});
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><ExpenseArtifactPanel tenant={id} actor={id} expense={id}/></QueryClientProvider>);}
async function upload(){await screen.findByText('Nenhum comprovante adicional anexado.');fireEvent.change(screen.getByLabelText('Arquivo para este gasto'),{target:{files:[new File(['image'],'recibo.jpg')]}});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Enviar e validar arquivo'}));});}
it('requires a separate reason and confirmation, and keeps confirmed success when refresh fails',async()=>{
 mocks.upload.mockResolvedValue({artifact_id:id,state:'sanitized_derivative',usable:true});mocks.attach.mockResolvedValue({confirmed:true});mount();await upload();
 await screen.findByLabelText('Motivo do anexo');expect(mocks.attach).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Anexar cópia validada ao gasto'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Motivo do anexo'),{target:{value:'Comprovante recebido posteriormente'}});mocks.read.mockRejectedValue(new Error('refresh offline'));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Anexar cópia validada ao gasto'}));});
 await screen.findByText('Comprovante anexado. O gasto e seus valores foram preservados.');await screen.findByText('O anexo foi confirmado, mas a lista não atualizou. Reabra a consulta.');
 expect(mocks.attach).toHaveBeenCalledWith(id,id,id,{artifact:id,reason:'Comprovante recebido posteriormente'});expect(screen.queryByRole('button',{name:'Anexar cópia validada ao gasto'})).not.toBeInTheDocument();
});
it('shows quarantine without offering attachment or creating a financial action',async()=>{
 mocks.upload.mockResolvedValue({artifact_id:id,state:'quarantined',usable:false});mount();await upload();
 await waitFor(()=>expect(screen.getByText(/Original recebido em quarentena/)).toBeInTheDocument());expect(screen.queryByLabelText('Motivo do anexo')).not.toBeInTheDocument();expect(mocks.attach).not.toHaveBeenCalled();
});
