import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {EmployeeAdvanceActionWorkspace} from '@/components/financial/EmployeeAdvanceActionDialog';
import {EmployeeAdvancePaymentConfirmation} from '@/components/financial/EmployeeAdvancePaymentConfirmation';
import {employeeAdvanceActionKey} from '@/lib/financial/employeeAdvanceActionOutbox';
import {employeeAdvancePaymentKey} from '@/lib/financial/employeeAdvancePaymentOutbox';
import {advancePaymentPreview,paymentScope} from './helpers/employeeAdvancePaymentFixture';

const mocks=vi.hoisted(()=>({readAction:vi.fn(),sendAction:vi.fn(),sendPayment:vi.fn()}));
vi.mock('@/lib/financial/employeeAdvanceActionClient',()=>({readEmployeeAdvanceAction:(...args:unknown[])=>mocks.readAction(...args),sendEmployeeAdvanceAction:(...args:unknown[])=>mocks.sendAction(...args)}));
vi.mock('@/lib/financial/employeeAdvancePaymentClient',()=>({sendEmployeeAdvancePayment:(...args:unknown[])=>mocks.sendPayment(...args)}));
const {tenant,actor,advance}=paymentScope;
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async<T,>(_key:string,work:()=>Promise<T>)=>work()}});mocks.readAction.mockResolvedValue({can_execute:true,revision:'a'.repeat(32),advance:{employee_name:'Funcionário QA',status:'pending',amount_cents:'10000',paid_cents:'0'}});});
afterEach(cleanup);

it('discards an incompatible approval or cancellation request',async()=>{const key=employeeAdvanceActionKey(tenant,actor);localStorage.setItem(key,'broken');render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EmployeeAdvanceActionWorkspace tenant={tenant} actor={actor} advance={advance} action="approve"/></QueryClientProvider>);expect(await screen.findByRole('alert')).toHaveTextContent('inconsistente');fireEvent.click(screen.getByRole('button',{name:'Descartar pedido incompatível'}));expect(localStorage.getItem(key)).toBeNull();expect(await screen.findByLabelText('Motivo')).toBeInTheDocument();expect(mocks.sendAction).not.toHaveBeenCalled();});

it('discards an incompatible advance-payment request',()=>{const key=employeeAdvancePaymentKey(tenant,actor);localStorage.setItem(key,'broken');render(<EmployeeAdvancePaymentConfirmation {...paymentScope} preview={advancePaymentPreview()} refresh={async()=>{}}/>);expect(screen.getByRole('alert')).toHaveTextContent('inconsistente');fireEvent.click(screen.getByRole('button',{name:'Descartar pedido incompatível'}));expect(localStorage.getItem(key)).toBeNull();expect(screen.getByLabelText('Motivo do vínculo')).toBeInTheDocument();expect(mocks.sendPayment).not.toHaveBeenCalled();});
