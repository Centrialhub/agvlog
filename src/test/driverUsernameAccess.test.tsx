import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Auth from '@/pages/Auth';
import SetPassword from '@/pages/SetPassword';
import { DriverAccessControls } from '@/components/drivers/DriverAccessControls';
import { LegacyDriverAccountsDialog } from '@/components/drivers/LegacyDriverAccountsDialog';
import { driverLoginEmail, normalizeDriverUsername, validateDriverPassword } from '@/lib/auth/driverCredentials';

const mock = vi.hoisted(() => ({ login: vi.fn(), reset: vi.fn(), update: vi.fn(), invoke: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), user: null as null | { email: string } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { signInWithPassword: mock.login, resetPasswordForEmail: mock.reset, updateUser: mock.update }, functions: { invoke: mock.invoke } } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ backendUnavailable: false, user: mock.user, loading: false, signOut: vi.fn() }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ error: mock.error, success: mock.success, info: mock.info }) }));
const clients: QueryClient[]=[];
afterEach(()=>{cleanup();clients.splice(0).forEach(client=>client.clear());sessionStorage.clear();vi.restoreAllMocks();});
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); mock.user = null; mock.login.mockResolvedValue({ error: null }); mock.reset.mockResolvedValue({ error: null }); });
const password = 'SenhaNova12345';
function auth(driver = true) { render(<MemoryRouter initialEntries={[driver ? '/auth?access=driver' : '/auth']}><Auth /></MemoryRouter>); }
const requestId='91000000-0000-4000-8000-000000000081';
function controls(kind: 'none' | 'managed' | 'legacy' = 'none') {
  let current=kind;
  const receipts=new Set<string>();
  mock.invoke.mockImplementation(async(name,{body})=>{
    expect(name).toBe('manage-driver-access');
    expect(body.tenant_id).toBe('tenant-a');expect(body.driver_id).toBe('driver-a');
    if(body.action==='inspect') {
      expect(body).toEqual({tenant_id:'tenant-a',driver_id:'driver-a',action:'inspect',version:3});
      return {error:null,data:{version:3,kind:current==='legacy'?'linked':current,
        username:current==='managed'?'joao.silva':null,active:current!=='none',
        capabilities:{create_access:current==='none',change_password:current==='managed',change_identity:false,delete_identity:false,unlink:false}}};
    }
    if(body.action==='create'){current='managed';return {error:null,data:{success:true,user_id:'synthetic-created',username:'joao.silva'}};}
    if(body.action==='password') {
      expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);receipts.add(body.request_id);
      return {error:null,data:{success:true,state:'succeeded',request_id:body.request_id}};
    }
    if(body.action==='credential_status' && receipts.has(body.request_id))
      return {error:null,data:{state:'succeeded',request_id:body.request_id}};
    throw new Error('Unexpected credential action or receipt identity in fixture');
  });
  const client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});clients.push(client);
  return render(<QueryClientProvider client={client}><DriverAccessControls tenantId="tenant-a" driverId="driver-a" /></QueryClientProvider>);
}

describe('driver username policy', () => {
  it('normalizes the username and derives the internal email', () => {
    expect(normalizeDriverUsername('  Joao.Silva  ')).toBe('joao.silva');
    expect(driverLoginEmail('Joao.Silva')).toBe('joao.silva@usuario.com');
  });
  it.each(['a', 'josé', 'joao@email.com', '.joao', 'joao..silva', 'a'.repeat(41)])('rejects invalid username %s', username => expect(() => driverLoginEmail(username)).toThrow());
  it('keeps strong passwords and rejects bcrypt byte overflow', () => {
    expect(() => validateDriverPassword(password)).not.toThrow();
    expect(() => validateDriverPassword('fraca')).toThrow();
    expect(() => validateDriverPassword(`Aa1${'á'.repeat(35)}`)).toThrow();
  });
});
describe('driver login and password ownership', () => {
  it('signs in using the synthetic email while presenting only username', async () => {
    auth(); fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: ' Joao.Silva ' } }); fireEvent.change(screen.getByLabelText('Senha'), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(mock.login).toHaveBeenCalledWith({ email: 'joao.silva@usuario.com', password }));
    expect(screen.queryByRole('button', { name: 'Esqueci minha senha' })).toBeNull(); expect(mock.reset).not.toHaveBeenCalled();
  });
  it('rejects email input in driver mode before calling Auth', async () => {
    auth(); fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'joao@empresa.com' } }); fireEvent.change(screen.getByLabelText('Senha'), { target: { value: password } }); fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(mock.error).toHaveBeenCalled()); expect(mock.login).not.toHaveBeenCalled();
  });
  it('keeps panel email login and email recovery available', async () => {
    auth(false); fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'operador@empresa.com' } }); fireEvent.change(screen.getByLabelText('Senha'), { target: { value: password } }); fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(mock.login).toHaveBeenCalledWith({ email: 'operador@empresa.com', password })); fireEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }));
    await waitFor(() => expect(mock.reset).toHaveBeenCalledWith('operador@empresa.com', expect.any(Object)));
  });
  it('uses a driver-specific invalid credentials message', async () => {
    mock.login.mockResolvedValue({ error: { code: 'invalid_credentials' } }); auth(); fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'joao' } }); fireEvent.change(screen.getByLabelText('Senha'), { target: { value: password } }); fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith('Usuário ou senha inválidos.'));
  });
  it('clears credentials when switching login modes', () => {
    auth(); fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'joao' } }); fireEvent.change(screen.getByLabelText('Senha'), { target: { value: password } }); fireEvent.click(screen.getByRole('button', { name: 'Painel e clientes' }));
    expect(screen.getByLabelText('Email')).toHaveValue(''); expect(screen.getByLabelText('Senha')).toHaveValue('');
  });
  it('directs managed drivers from the personal password page to operations', () => {
    mock.user = { email: 'joao@usuario.com' }; render(<MemoryRouter><SetPassword /></MemoryRouter>);
    expect(screen.queryByLabelText('Nova senha')).toBeNull(); expect(screen.getByText(/A senha do motorista é definida/)).toBeInTheDocument(); expect(mock.update).not.toHaveBeenCalled();
  });
});
describe('operational driver access form', () => {
  it('creates the account for a driver and clears entered passwords on success', async () => {
    controls(); await screen.findByLabelText('Usuário'); fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'Joao.Silva' } }); fireEvent.change(screen.getByLabelText('Senha inicial'), { target: { value: password } }); fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: password } }); fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('manage-driver-access', { body: { tenant_id: 'tenant-a', driver_id: 'driver-a', action: 'create', username: 'joao.silva', password } }));
    expect(await screen.findByLabelText('Nova senha')).toHaveValue('');
    expect(screen.getByLabelText('Confirmar senha')).toHaveValue('');
  });
  it('updates the password without changing an existing username', async () => {
    vi.spyOn(crypto,'randomUUID').mockReturnValue(requestId);
    controls('managed'); await screen.findByLabelText('Usuário'); expect(screen.getByLabelText('Usuário')).toHaveAttribute('readonly'); fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: password } }); fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: password } }); fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('manage-driver-access', { body: { tenant_id: 'tenant-a', driver_id: 'driver-a', action: 'password', username: 'joao.silva', password, request_id: requestId } }));
    await waitFor(()=>expect(mock.invoke).toHaveBeenCalledWith('manage-driver-access',{body:{tenant_id:'tenant-a',driver_id:'driver-a',action:'credential_status',request_id:requestId}}));
    await waitFor(()=>expect(screen.getByLabelText('Nova senha')).toHaveValue(''));
    expect(mock.invoke.mock.calls.filter(([, {body}])=>body.action==='password')).toHaveLength(1);
  });
  it('preserves a restricted legacy identity without offering deletion or recreation', async () => {
    controls('legacy');await screen.findByText('Conta de acesso vinculada.');
    expect(screen.getByText(/Não exclua nem desvincule registros/)).toBeVisible();
    expect(screen.queryByLabelText('Usuário')).toBeNull();
    expect(screen.queryByRole('button',{name:/Criar acesso|Converter acesso|Trocar senha|Excluir/})).toBeNull();
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.invoke.mock.calls[0][1].body).toEqual({tenant_id:'tenant-a',driver_id:'driver-a',action:'inspect',version:3});
  });
  it('does not submit mismatching passwords', async () => {
    controls(); await screen.findByLabelText('Usuário'); fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'joao' } }); fireEvent.change(screen.getByLabelText('Senha inicial'), { target: { value: password } }); fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: 'OutraSenha1234' } }); fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith('As senhas não coincidem.')); expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
});

describe('credential receipt identity and uncertainty', () => {
  it.each([
    ['pending', requestId],
    ['unconfirmed', requestId],
    ['not_found', requestId],
    ['succeeded', '91000000-0000-4000-8000-000000000082'],
  ])('keeps a timed-out password write blocked after reopen for receipt %s / %s', async (state, receiptId) => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(requestId);
    let ready = false;
    let settleWrite!: (result: { data: null; error: Error }) => void;
    const writeResult = new Promise<{ data: null; error: Error }>(resolve => { settleWrite = resolve; });
    mock.invoke.mockImplementation(async (name, { body }) => {
      expect(name).toBe('manage-driver-access');
      expect(body.tenant_id).toBe('tenant-a');
      expect(body.driver_id).toBe('driver-a');
      if (body.action === 'inspect') {
        expect(body).toEqual({ tenant_id: 'tenant-a', driver_id: 'driver-a', action: 'inspect', version: 3 });
        return { error: null, data: { version: 3, kind: 'managed', username: 'joao.silva', active: true,
          capabilities: { create_access: false, change_password: true, change_identity: false, delete_identity: false, unlink: false } } };
      }
      if (body.action === 'password') {
        expect(body).toEqual({ tenant_id: 'tenant-a', driver_id: 'driver-a', action: 'password', username: 'joao.silva', password, request_id: requestId });
        return writeResult;
      }
      expect(body).toEqual({ tenant_id: 'tenant-a', driver_id: 'driver-a', action: 'credential_status', request_id: requestId });
      return { error: null, data: ready ? { state: 'succeeded', request_id: requestId } : { state, request_id: receiptId } };
    });
    const mount = () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      clients.push(client);
      return { client, view: render(<QueryClientProvider client={client}><DriverAccessControls tenantId="tenant-a" driverId="driver-a" /></QueryClientProvider>) };
    };
    const writes = () => mock.invoke.mock.calls.filter(([, { body }]) => body.action === 'password');
    const first = mount();
    fireEvent.change(await screen.findByLabelText('Nova senha'), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: password } });
    const form = screen.getByRole('button', { name: 'Trocar senha' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Salvando...' })).toBeDisabled();
    settleWrite({ data: null, error: new Error('Synthetic response timeout') });
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('Nova senha')).toBeNull();
    const stored = Object.values(sessionStorage).join('');
    expect(stored).toContain(requestId);
    expect(stored).not.toContain(password);
    first.view.unmount();
    first.client.clear();
    mount();
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Trocar senha' })).toBeNull();
    expect(screen.queryByLabelText('Nova senha')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(mock.invoke.mock.calls.filter(([, { body }]) => body.action === 'credential_status')).toHaveLength(3));
    expect(screen.queryByLabelText('Nova senha')).toBeNull();
    expect(writes()).toHaveLength(1);
    ready = true;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByRole('button', { name: 'Trocar senha' });
    expect(screen.getByLabelText('Nova senha')).toHaveValue('');
    expect(screen.getByLabelText('Confirmar senha')).toHaveValue('');
    expect(writes()).toHaveLength(1);
    expect(mock.invoke.mock.calls.filter(([, { body }]) => body.action === 'credential_status')).toHaveLength(4);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('legacy account retirement panel', () => {
  it('requires confirmation, skips blocked accounts, and reports deletion results', async () => {
    mock.invoke.mockImplementation((_name, { body }) => Promise.resolve({ error: null, data: body.action === 'legacy_list' ? { accounts: [{ user_id: 'old-a', label: 'Motorista A', blocked: null }, { user_id: 'shared-b', label: 'Conta B', blocked: 'Conta compartilhada' }] } : { success: true } }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });clients.push(client);
    render(<QueryClientProvider client={client}><LegacyDriverAccountsDialog tenantId="tenant-a" onClose={vi.fn()} /></QueryClientProvider>);
    const button = await screen.findByRole('button', { name: 'Excluir todas as contas antigas disponíveis' }); expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(button);
    await screen.findByText('Motorista A: conta excluída.');
    expect(mock.invoke.mock.calls.filter(([, { body }]) => body.action === 'retire_legacy').map(([, { body }]) => body.user_id)).toEqual(['old-a']);
    expect(screen.getByText('Conta compartilhada')).toBeInTheDocument();
  });
});
