import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NativeStatementAccount} from '@/components/financial/NativeStatementAccount';
import {nativeStatementAccountSchema} from '@/lib/financial/nativeStatementAccountContract';
const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',()=>({readNativeStatementAccount:mock.read}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),statement=crypto.randomUUID(),account=crypto.randomUUID();
const result={version:1,tenant_id:tenant,import_id:statement,bank_account_id:account,account_name:'Conta operação',status:'mismatch',method:'ofx_exact_v1',matching_account_count:0,source_verification_id:crypto.randomUUID(),revision:'a'.repeat(32),coverage_verification:'pending',checks:[{field:'account_number',file_value:'000123-4',registered_value:'123-4',status:'different'}]};
beforeEach(()=>{vi.clearAllMocks();mock.read.mockResolvedValue(result);});afterEach(cleanup);
describe('native account comparison',()=>{
 it('shows the differing native and registered identities without certifying the period',async()=>{
  render(<QueryClientProvider client={new QueryClient()}><NativeStatementAccount tenant={tenant} actor={actor} statement={statement} account={account}/></QueryClientProvider>);
  expect(mock.read).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Conferir identificação da conta'}));
  await screen.findByText('000123-4');expect(screen.getByText('123-4')).toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('Identificação da conta divergente');
  expect(screen.getByText(/não confirma a autenticidade/)).toBeInTheDocument();expect(mock.read).toHaveBeenCalledWith(tenant,statement,account);
 });
 it('rejects a claimed match without all four matching fields',()=>{
  expect(()=>nativeStatementAccountSchema.parse({...result,status:'matched_exact'})).toThrow('Correspondência da conta sem evidências completas');
 });
});
