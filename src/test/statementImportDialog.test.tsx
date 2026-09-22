import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {StatementImportDialog} from '@/components/financial/StatementImportDialog';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {sicoobPixMatrix} from './helpers/sicoobPixFixture';
import {detectSicoobPixLayout} from '../../supabase/functions/_shared/finance-sicoob-pix-layout';
const mocks=vi.hoisted(()=>({load:vi.fn(),run:vi.fn(),abandon:vi.fn(),inspect:vi.fn(),prepare:vi.fn(),accountsError:false,accountsPending:false,refetchAccounts:vi.fn()}));
vi.mock('@/hooks/useFinancialPayments',()=>({useBankAccounts:()=>({data:mocks.accountsError?undefined:[{id:'account',name:'Banco QA'}],isError:mocks.accountsError,isPending:mocks.accountsPending,refetch:mocks.refetchAccounts})}));
vi.mock('@/lib/financial/statementImportStore',()=>({statementImportStore:{load:mocks.load}}));
vi.mock('@/lib/financial/statementImportClient',()=>({statementImportWorkflow:()=>({run:mocks.run,abandon:mocks.abandon}),inspectStatementLayout:mocks.inspect,prepareStatementImport:mocks.prepare}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID();
const renderDialog=(dialog:ReactNode)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{dialog}</QueryClientProvider>);
const mount=()=>renderDialog(<StatementImportDialog tenant={tenant} actor={actor} onClose={vi.fn()} onImported={vi.fn()}/>);
beforeEach(()=>{vi.clearAllMocks();mocks.accountsError=false;mocks.accountsPending=false;mocks.load.mockResolvedValue(null);mocks.inspect.mockResolvedValue({matrix:[['Data','Descrição','Valor'],['01/01/2026','PIX','-500,00']],sheetNames:['CSV']});});
describe('statement import preparation and recovery UI',()=>{
  it('fills Sicoob payment mapping and period without sending the file before review',async()=>{
    const matrix=sicoobPixMatrix(),sicoobPix=detectSicoobPixLayout(matrix)!;
    mocks.inspect.mockResolvedValue({matrix,sheetNames:['Extrato Pix'],sicoobPix});
    const file=new File(['fixture'],'pix.xlsx');mount();
    const input=await screen.findByLabelText('Arquivo original');
    fireEvent.change(input,{target:{files:[file]}});
    await screen.findByText(/Relatório de pagamentos Pix do Sicoob reconhecido/);
    expect(screen.getByLabelText('Linha do cabeçalho')).toHaveValue(11);
    expect(screen.getByLabelText('Coluna de descrição')).toHaveValue('2');
    expect(screen.getByLabelText('Valor com sinal')).toHaveValue('');
    expect(screen.getByLabelText('Débito separado')).toHaveValue('8');
    expect(screen.getByLabelText('Início do período')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('Fim do período')).toHaveValue('2026-09-08');
    expect(screen.getByLabelText('Conta do extrato')).toHaveValue('');
    expect(mocks.run).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('prefills the selected account and period without replacing an existing recovery request',async()=>{
    const initial={account:'account',start:'2026-09-01',end:'2026-09-10'};
    const view=renderDialog(<StatementImportDialog tenant={tenant} actor={actor} initial={initial} onClose={vi.fn()} onImported={vi.fn()}/>);
    await screen.findByLabelText('Conta do extrato');
    expect(screen.getByLabelText('Conta do extrato')).toHaveValue('account');
    expect(screen.getByLabelText('Início do período')).toHaveValue(initial.start);
    expect(screen.getByLabelText('Fim do período')).toHaveValue(initial.end);
    view.unmount();
    mocks.load.mockResolvedValue({file_name:'anterior.csv',phase:'verify',uncertain:true,command:{rows:[{}]}});
    renderDialog(<StatementImportDialog tenant={tenant} actor={actor} initial={initial} onClose={vi.fn()} onImported={vi.fn()}/>);
    await screen.findByText(/anterior.csv/);
    expect(screen.queryByLabelText('Conta do extrato')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Retomar importação'}));
    await waitFor(()=>expect(mocks.run).toHaveBeenCalledWith(tenant,actor,undefined,undefined));
  });
  it('shows native OFX account evidence and fills dates without requiring column mapping',async()=>{
    mocks.inspect.mockResolvedValue({matrix:[],sheetNames:['OFX'],nativeOfx:{account:{bank_id:'001',branch_id:'1234',account_id:'000123-4'},period:{start:{date:'2026-09-01'},end:{date:'2026-09-30'}},rows:[{posted_on:'2026-08-31'}]}});
    mount();await screen.findByLabelText('Arquivo original');fireEvent.change(screen.getByLabelText('Arquivo original'),{target:{files:[new File(['<OFX>'],'banco.ofx')]}});
    await screen.findByText(/Dados lidos diretamente do OFX/);expect(screen.getByLabelText('Início do período')).toHaveValue('2026-08-31');expect(screen.getByLabelText('Fim do período')).toHaveValue('2026-09-30');
    expect(screen.queryByLabelText('Coluna de data')).not.toBeInTheDocument();expect(screen.queryByLabelText('Separador CSV')).not.toBeInTheDocument();expect(mocks.run).not.toHaveBeenCalled();
  });
  it('requires an explicit preview and confirmation before sending the preserved request',async()=>{
    const pending={command:{rows:[{posted_on:'2026-01-01',description:'PIX',amount_cents:-50000}]}},file=new File(['Data;Descrição;Valor'],'extrato.csv');
    mocks.prepare.mockResolvedValue({pending,totals:{inflow_cents:'0',outflow_cents:'50000',net_cents:'-50000'}});
    mount();await screen.findByLabelText('Arquivo original');
    fireEvent.change(screen.getByLabelText('Conta do extrato'),{target:{value:'account'}});
    fireEvent.change(screen.getByLabelText('Início do período'),{target:{value:'2026-01-01'}});
    fireEvent.change(screen.getByLabelText('Fim do período'),{target:{value:'2026-01-31'}});
    fireEvent.change(screen.getByLabelText('Arquivo original'),{target:{files:[file]}});
    await waitFor(()=>expect(screen.getByRole('button',{name:'Preparar prévia'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Preparar prévia'}));
    await screen.findByText(/1 registros · Entradas R\$ 0,00 · Saídas R\$ 500,00/);expect(mocks.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Importar e conferir dados'}));
    await waitFor(()=>expect(mocks.run).toHaveBeenCalledWith(tenant,actor,pending,file));
  });
  it('enables preview preparation for a readable Excel statement',async()=>{
    mocks.inspect.mockResolvedValue({matrix:[['Data','Descrição','Valor'],[46023,'PIX recebido',500]],sheetNames:['Extrato']});
    mocks.prepare.mockResolvedValue({pending:{command:{rows:[{posted_on:'2026-01-01',description:'PIX recebido',amount_cents:50000}]}},totals:{inflow_cents:'50000',outflow_cents:'0',net_cents:'50000'}});
    const file=new File([new Uint8Array([0x50,0x4b,0x03,0x04])],'extrato.xlsx');mount();await screen.findByLabelText('Arquivo original');
    fireEvent.change(screen.getByLabelText('Conta do extrato'),{target:{value:'account'}});
    fireEvent.change(screen.getByLabelText('Início do período'),{target:{value:'2026-01-01'}});
    fireEvent.change(screen.getByLabelText('Fim do período'),{target:{value:'2026-01-31'}});
    fireEvent.change(screen.getByLabelText('Arquivo original'),{target:{files:[file]}});
    const preview=await screen.findByRole('button',{name:'Preparar prévia'});await waitFor(()=>expect(preview).toBeEnabled());
    fireEvent.click(preview);await waitFor(()=>expect(mocks.prepare).toHaveBeenCalledWith(file,expect.objectContaining({tenant,actor,account:'account',start:'2026-01-01',end:'2026-01-31'}),expect.objectContaining({sheet_index:0})));
    expect(screen.getByText(/Importação de lançamentos: OFX, CSV ou XLSX/)).toBeInTheDocument();
    expect(screen.getByText(/XLS legadas precisam ser convertidas para XLSX/)).toBeInTheDocument();
  });
  it('rejects legacy XLS before preview and asks for conversion to XLSX',async()=>{
    mount();const input=await screen.findByLabelText('Arquivo original');
    expect(input).toHaveAttribute('accept','.csv,.xlsx,.ofx,.pdf,.jpg,.jpeg,.png');
    fireEvent.change(input,{target:{files:[new File([new Uint8Array([0xd0,0xcf,0x11,0xe0])],'extrato.xls')]}});
    await screen.findByText(/XLS legadas não podem ser importadas com segurança/);
    expect(mocks.inspect).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Preparar prévia'})).toBeDisabled();
  });
  it('offers only recovery for an existing verification-stage request',async()=>{
    mocks.load.mockResolvedValue({file_name:'preservado.csv',phase:'verify',uncertain:false,command:{rows:[{}]}});
    mount();await screen.findByText('Próxima etapa: Conferir dados preservados no servidor');
    expect(screen.queryByLabelText('Arquivo original')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Retomar importação'}));
    await waitFor(()=>expect(mocks.run).toHaveBeenCalledWith(tenant,actor,undefined,undefined));
  });
  it('keeps delimiter selection available after an initial CSV read failure',async()=>{
    mocks.inspect.mockRejectedValueOnce(new Error('CSV inválido'));
    mount();await screen.findByLabelText('Arquivo original');
    const file=new File(['Data,Descrição,Valor'],'extrato.csv');
    fireEvent.change(screen.getByLabelText('Arquivo original'),{target:{files:[file]}});await screen.findByText('CSV inválido');
    fireEvent.change(screen.getByLabelText('Separador CSV'),{target:{value:','}});
    await waitFor(()=>expect(mocks.inspect).toHaveBeenLastCalledWith(file,',',0));
  });
  it('does not expose a new import form while durable recovery is unavailable',async()=>{
    mocks.load.mockRejectedValue(new Error('database unavailable'));mount();
    await screen.findByText(/Não foi possível abrir os pedidos preservados/);
    expect(screen.queryByLabelText('Arquivo original')).not.toBeInTheDocument();expect(mocks.run).not.toHaveBeenCalled();
  });
  it('shows account loading failures and lets the user retry without implying an empty catalog',async()=>{
    mocks.accountsError=true;mount();await screen.findByText(/Não foi possível consultar as contas bancárias/);
    expect(screen.getByLabelText('Conta do extrato')).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
    expect(mocks.refetchAccounts).toHaveBeenCalledTimes(1);
  });
});
