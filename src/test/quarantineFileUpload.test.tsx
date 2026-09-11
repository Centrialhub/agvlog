import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {describe,it,expect,vi,beforeEach} from 'vitest';
const send=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/financial/uploadArtifactRecovery',()=>({uploadRecoverableFinanceArtifact:send}));
import {QuarantineFileUpload} from '@/components/financial/QuarantineFileUpload';
const id='11111111-1111-4111-8111-111111111111';
describe('quarantine file state',()=>{
 beforeEach(()=>{send.mockReset();});
 it('preserves PDF explicitly and never labels it imported or analyzed',async()=>{
  send.mockResolvedValue({artifact_id:id,state:'quarantined'});
  render(<QuarantineFileUpload tenant={id} actor={id} account={id} file={new File(['pdf'],'extrato.pdf')}/>);
  fireEvent.click(screen.getByRole('button',{name:'Preservar em quarentena'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Ainda não está disponível como comprovante ou extrato analisado');
  expect(send).toHaveBeenCalledWith(expect.objectContaining({sourceId:id,format:'pdf'}));
  expect(screen.queryByRole('button',{name:/importar/i})).not.toBeInTheDocument();
 });
 it('keeps retry available after an uncertain response and blocks missing source',async()=>{
  send.mockRejectedValue(new Error('Envio sem confirmação'));
  const view=render(<QuarantineFileUpload tenant={id} actor={id} account="" file={new File(['xlsx'],'extrato.xlsx')}/>);
  expect(screen.getByRole('button')).toBeDisabled();
  view.rerender(<QuarantineFileUpload tenant={id} actor={id} account={id} file={new File(['xlsx'],'extrato.xlsx')}/>);
  fireEvent.click(screen.getByRole('button'));expect(await screen.findByRole('alert')).toHaveTextContent('Envio sem confirmação');
  await waitFor(()=>expect(screen.getByRole('button')).toBeEnabled());
 });
});
