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
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mock.user = null; mock.login.mockResolvedValue({ error: null }); mock.reset.mockResolvedValue({ error: null }); });
const password = 'SenhaNova12345';
function auth(driver = true) { render(<MemoryRouter initialEntries={[driver ? '/auth?access=driver' : '/auth']}><Auth /></MemoryRouter>); }
function controls(kind: 'none' | 'managed' | 'legacy' = 'none') {
  mock.invoke.mockImplementation((_name, { body }) => Promise.resolve({ error: null, data: body.action === 'inspect' ? { kind, username: kind === 'managed' ? 'joao.silva' : null, active: true } : { success: true } }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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
    await waitFor(() => expect(screen.getByLabelText('Senha inicial')).toHaveValue(''));
  });
  it('updates the password without changing an existing username', async () => {
    controls('managed'); await screen.findByLabelText('Usuário'); expect(screen.getByLabelText('Usuário')).toHaveAttribute('readonly'); fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: password } }); fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: password } }); fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('manage-driver-access', { body: { tenant_id: 'tenant-a', driver_id: 'driver-a', action: 'password', username: 'joao.silva', password } }));
  });
  it('requires deletion and recreation of legacy accounts', async () => {
    controls('legacy'); await screen.findByText(/Esta conta pertence ao modelo antigo/); expect(screen.queryByLabelText('Usuário')).toBeNull(); expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it('does not submit mismatching passwords', async () => {
    controls(); await screen.findByLabelText('Usuário'); fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'joao' } }); fireEvent.change(screen.getByLabelText('Senha inicial'), { target: { value: password } }); fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: 'OutraSenha1234' } }); fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith('As senhas não coincidem.')); expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
});

describe('legacy account retirement panel', () => {
  it('requires confirmation, skips blocked accounts, and reports deletion results', async () => {
    mock.invoke.mockImplementation((_name, { body }) => Promise.resolve({ error: null, data: body.action === 'legacy_list' ? { accounts: [{ user_id: 'old-a', label: 'Motorista A', blocked: null }, { user_id: 'shared-b', label: 'Conta B', blocked: 'Conta compartilhada' }] } : { success: true } }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><LegacyDriverAccountsDialog tenantId="tenant-a" onClose={vi.fn()} /></QueryClientProvider>);
    const button = await screen.findByRole('button', { name: 'Excluir todas as contas antigas disponíveis' }); expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(button);
    await screen.findByText('Motorista A: conta excluída.');
    expect(mock.invoke.mock.calls.filter(([, { body }]) => body.action === 'retire_legacy').map(([, { body }]) => body.user_id)).toEqual(['old-a']);
    expect(screen.getByText('Conta compartilhada')).toBeInTheDocument();
  });
});
