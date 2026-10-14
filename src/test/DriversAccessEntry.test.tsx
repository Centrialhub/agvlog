// PATCH2 UI and independent-review recovery regressions.
// Local fixtures only: no deployed Auth, database, tokens or business writes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Drivers from '@/pages/Drivers';
import { createRef } from 'react';
import { CreateDriverAccessDialog } from '@/components/drivers/CreateDriverAccessDialog';

const fixture = vi.hoisted(() => ({
  role: 'admin' as string | null, tenantId: 'tenant-a', actorId: 'actor-a',
  kind: 'none' as 'none' | 'managed' | 'legacy', failCreate: false, loseResponse: false, foreign: false, empty: false, inactive: false, inspectError: false, holdCreate: false, finishCreate: null as null | (() => void),
  offline: false, holdInspection: false, finishInspection: null as null | (() => void),
  catalog: vi.fn(), invoke: vi.fn(), success: vi.fn(), error: vi.fn(),
}));
vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: fixture.tenantId }, currentRole: fixture.role }),
  useIsAdmin: () => fixture.role === 'owner' || fixture.role === 'admin',
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: fixture.actorId } }) }));
vi.mock('@/hooks/useTenantCapabilities', () => ({ useTenantCapabilities: () => ({ isEnabled: () => false }) }));
vi.mock('@/hooks/useWorkspaceSsxAccounts', () => ({ useWorkspaceSsxAccounts: () => ({ data: [] }) }));
vi.mock('@/hooks/useAlertStore', () => ({ useScopedAlerts: () => ({ confirmAction: vi.fn() }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ success: fixture.success, error: fixture.error }) }));
vi.mock('@/lib/operator/operatorReferencePagination', () => ({ readOperatorReferenceCatalog: fixture.catalog }));
vi.mock('@/lib/supabase/fetchAllPages', () => ({ fetchAllPostgrestPages: async () => [] }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: fixture.invoke } } }));

const clients: QueryClient[] = [];
beforeEach(() => {
  onlineManager.setOnline(true);
  vi.clearAllMocks(); sessionStorage.clear();
  fixture.role = 'admin'; fixture.tenantId = 'tenant-a'; fixture.actorId = 'actor-a';
  fixture.offline = false; fixture.holdInspection = false; fixture.finishInspection = null;
  fixture.kind = 'none'; fixture.failCreate = false; fixture.loseResponse = false; fixture.foreign = false; fixture.empty = false; fixture.inactive = false; fixture.inspectError = false; fixture.holdCreate = false; fixture.finishCreate = null;
  fixture.catalog.mockImplementation(async ({ resource }: { resource: string }) => resource !== 'drivers' || fixture.empty ? [] : [
    { id: 'driver-a', tenant_id: fixture.foreign ? 'other-tenant' : fixture.tenantId, name: 'Motorista A', active: !fixture.inactive, user_id: fixture.kind === 'none' ? null : 'account-a', current_vehicle: null },
    { id: 'driver-b', tenant_id: fixture.tenantId, name: 'Motorista B', active: true, user_id: 'account-b', current_vehicle: null },
  ]);
  fixture.invoke.mockImplementation(async (name, { body }) => {
    if (name !== 'manage-driver-access') throw new Error('Unexpected fixture endpoint');
    if (body.action === 'inspect' && fixture.holdInspection) await new Promise<void>(resolve => { fixture.finishInspection = resolve; });
    if (body.action === 'inspect' && fixture.inspectError) return { error: null, data: { error: 'Inspeção indisponível na fixture.' } };
    if (body.action === 'inspect') {
      expect(body.version).toBe(3);
      const kind=body.driver_id==='driver-b'?'managed':fixture.kind==='legacy'?'linked':fixture.kind;
      return {error:null,data:{version:3,kind,driver_id:body.driver_id,
        username:kind==='managed'?(body.driver_id==='driver-b'?'motorista.b':'motorista.a'):null,active:kind!=='none',
        capabilities:{create_access:kind==='none',change_password:kind==='managed',change_identity:false,delete_identity:false,unlink:false}}};
    }
    if(body.action!=='create') throw new Error('Unexpected access mutation or receipt in creation fixture');
    if (fixture.holdCreate) await new Promise<void>(resolve => { fixture.finishCreate = resolve; });
    if (fixture.failCreate && fixture.inspectError === false) return { error: null, data: { error: 'Criação recusada na fixture.' } };
    if (fixture.failCreate) { fixture.inspectError = true; return { error: null, data: { error: 'Criação recusada na fixture.' } }; }
    if (body.action === 'create') fixture.kind = 'managed';
    if (fixture.offline) onlineManager.setOnline(false);
    if (fixture.loseResponse) return { error: null, data: { error: 'O serviço não confirmou o resultado.' } };
    return { error: null, data: { success: true } };
  });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); onlineManager.setOnline(true); sessionStorage.clear(); });
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
  const page = () => <MemoryRouter><QueryClientProvider client={client}><Drivers /></QueryClientProvider></MemoryRouter>;
  const view = render(page());
  return Object.assign(() => view.rerender(page()), { client });
}
function mutations() {
  return fixture.invoke.mock.calls.filter(([, { body }]) => body.action !== 'inspect');
}
async function openCreate() {
  fireEvent.click(await screen.findByRole('button', { name: 'Criar acesso de Motorista A' }));
  await screen.findByLabelText('Usuário');
}
function fillCredentials() {
  fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: 'Motorista.A' } });
  fireEvent.change(screen.getByLabelText('Senha inicial'), { target: { value: 'FixtureSenha1234' } });
  fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: 'FixtureSenha1234' } });
}

describe('/drivers access entry', () => {
  it('focuses the required selector and restores the creation button after Escape', async () => {
    show(); await screen.findByText('Motorista A');
    const trigger = screen.getByRole('button', { name: 'Criar conta de acesso' });
    trigger.focus(); fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Motorista cadastrado' })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Motorista cadastrado' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus()); expect(fixture.invoke).not.toHaveBeenCalled();
  });
  it.each(['empty', 'inactive', 'foreign', 'linked'])('cannot create without an eligible existing driver: %s', async mode => {
    if (mode === 'empty') fixture.empty = true;
    if (mode === 'inactive') fixture.inactive = true;
    if (mode === 'foreign') fixture.foreign = true;
    if (mode === 'linked') fixture.kind = 'managed';
    show();
    const open = await screen.findByRole('button', { name: 'Criar conta de acesso' });
    await waitFor(() => expect(open).toBeEnabled()); fireEvent.click(open);
    expect(screen.getByRole('combobox', { name: 'Motorista cadastrado' })).toBeDisabled();
    expect(screen.getByText(/Nenhum motorista ativo sem conta/)).toBeVisible();
    expect(screen.queryByLabelText('Senha inicial')).not.toBeInTheDocument(); expect(fixture.invoke).not.toHaveBeenCalled();
  });
  it('prevents closing, changing the driver and duplicate submits while account creation is pending', async () => {
    fixture.holdCreate = true; show(); await screen.findByText('Motorista A');
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta de acesso' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Motorista cadastrado' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Motorista A' }));
    await screen.findByLabelText('Usuário'); fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvando...' })).toBeDisabled());
    expect(screen.getByRole('combobox', { name: 'Motorista cadastrado' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.getByRole('dialog', { name: 'Criar conta de acesso' })).toBeVisible();
    fireEvent.submit(screen.getByLabelText('Usuário').closest('form')!);
    expect(mutations()).toHaveLength(1); expect(fixture.kind).toBe('none');
    fixture.finishCreate!();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(mutations()).toHaveLength(1);
  });
  it('blocks further creation if the inspection fails after an uncertain result', async () => {
    fixture.loseResponse = true; show(); await openCreate(); fillCredentials();
    const original = fixture.invoke.getMockImplementation()!;
    fixture.invoke.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[1].body.action === 'create') fixture.inspectError = true;
      return result;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await screen.findByText('Inspeção indisponível na fixture.');
    expect(screen.queryByRole('button', { name: 'Criar acesso' })).not.toBeInTheDocument();
    expect(mutations()).toHaveLength(1); expect(fixture.kind).toBe('managed');
    fixture.inspectError = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByLabelText('Nova senha')).toHaveValue(''); expect(mutations()).toHaveLength(1);
  });

  it.each(['owner', 'admin'])('shows a visible creation action for authorized %s and opens the selected driver', async role => {
    fixture.role = role; show();
    const create = await screen.findByRole('button', { name: 'Criar acesso de Motorista A' });
    expect(create).toHaveTextContent('Criar acesso');
    expect(await screen.findByRole('button', { name: 'Gerenciar acesso de Motorista B' })).toHaveTextContent('Gerenciar acesso');
    fireEvent.click(create);
    const modal = await screen.findByRole('dialog', { name: 'Acesso de Motorista A' });
    expect(await within(modal).findByLabelText('Senha inicial')).toBeVisible();
    expect(within(modal).getByRole('button', { name: 'Criar acesso' })).toBeDisabled();
    expect(fixture.catalog).toHaveBeenCalledWith({ tenantId: 'tenant-a', actorId: 'actor-a', resource: 'drivers', includeInactive: true });
    expect(fixture.invoke).toHaveBeenCalledWith('manage-driver-access', { body: { tenant_id: 'tenant-a', driver_id: 'driver-a', action: 'inspect', version: 3 } });
    expect(mutations()).toHaveLength(0);
  });
  it.each(['operator', 'driver', 'client', 'viewer', null])('does not offer access management to role %s', async role => {
    fixture.role = role; show(); await screen.findByText('Motorista A');
    expect(screen.queryByRole('button', { name: /Criar conta de acesso|Criar acesso|Gerenciar acesso/ })).not.toBeInTheDocument();
    expect(fixture.invoke).not.toHaveBeenCalled();
  });
  it('offers separate registration and access creation, selecting an existing driver without opening CRUD', async () => {
    show(); await screen.findByText('Motorista A');
    expect(screen.getByRole('button', { name: 'Cadastrar motorista' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta de acesso' }));
    const modal = screen.getByRole('dialog', { name: 'Criar conta de acesso' });
    expect(within(modal).getByRole('combobox', { name: 'Motorista cadastrado' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Novo motorista' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nome completo')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Senha inicial')).not.toBeInTheDocument();
    fireEvent.keyDown(within(modal).getByRole('combobox', { name: 'Motorista cadastrado' }), { key: 'ArrowDown' });
    const choice = await screen.findByRole('option', { name: 'Motorista A' });
    expect(screen.queryByRole('option', { name: 'Motorista B' })).not.toBeInTheDocument();
    fireEvent.click(choice);
    expect(await screen.findByLabelText('Senha inicial')).toBeVisible();
    expect(fixture.invoke).toHaveBeenCalledWith('manage-driver-access', { body: { tenant_id: 'tenant-a', driver_id: 'driver-a', action: 'inspect', version: 3 } });
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await waitFor(() => expect(fixture.success).toHaveBeenCalledWith('Conta de motorista criada.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0][1].body).toMatchObject({ tenant_id: 'tenant-a', driver_id: 'driver-a', action: 'create' });
    // The fixture exposes only functions.invoke: a drivers insert/update would fail this flow.
  });
  it('cancels global account creation before choosing a driver without any request', async () => {
    show(); await screen.findByText('Motorista A');
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta de acesso' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(fixture.invoke).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('submits creation only after confirmation with the current tenant and selected driver', async () => {
    show(); await openCreate(); fillCredentials();
    expect(mutations()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await waitFor(() => expect(fixture.success).toHaveBeenCalledWith('Conta de motorista criada.'));
    expect(mutations()).toEqual([['manage-driver-access', { body: { tenant_id: 'tenant-a', driver_id: 'driver-a', action: 'create', username: 'motorista.a', password: 'FixtureSenha1234' } }]]);
    expect(await screen.findByLabelText('Nova senha')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(await screen.findByRole('button', { name: 'Gerenciar acesso de Motorista A' })).toHaveTextContent('Gerenciar acesso');
  });
  it('cancels without creating an account and discards the entered credentials', async () => {
    show(); await openCreate(); fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(mutations()).toHaveLength(0);
    await openCreate(); expect(screen.getByLabelText('Usuário')).toHaveValue(''); expect(screen.getByLabelText('Senha inicial')).toHaveValue('');
  });
  it('keeps the driver unlinked after a refused creation and does not retry automatically', async () => {
    fixture.failCreate = true; show(); await openCreate(); fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await waitFor(() => expect(fixture.error).toHaveBeenCalledWith('Criação recusada na fixture.'));
    expect(fixture.kind).toBe('none'); expect(mutations()).toHaveLength(1); expect(fixture.success).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('Senha inicial')).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.getByRole('button', { name: 'Criar acesso de Motorista A' })).toBeVisible();
  });
  it('reconciles a lost creation response without creating another account', async () => {
    fixture.loseResponse = true; show(); await openCreate(); fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await waitFor(() => expect(fixture.error).toHaveBeenCalled());
    expect(await screen.findByLabelText('Nova senha')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Criar acesso' })).not.toBeInTheDocument();
    expect(fixture.kind).toBe('managed'); expect(mutations()).toHaveLength(1);
    expect(fixture.invoke.mock.calls.filter(([, { body }]) => body.action === 'inspect').length).toBeGreaterThan(1);
  });
  it('manages an existing account without offering account creation', async () => {
    show(); fireEvent.click(await screen.findByRole('button', { name: 'Gerenciar acesso de Motorista B' }));
    expect(await screen.findByLabelText('Usuário')).toHaveValue('motorista.b');
    expect(screen.getByLabelText('Usuário')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Trocar senha' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Criar acesso' })).not.toBeInTheDocument(); expect(mutations()).toHaveLength(0);
  });
  it('preserves the legacy account restriction without sending a deletion', async () => {
    fixture.kind = 'legacy'; show(); fireEvent.click(await screen.findByRole('button', { name: 'Gerenciar acesso de Motorista A' }));
    await screen.findByText('Conta de acesso vinculada.');
    expect(screen.getByText(/Não exclua nem desvincule registros/)).toBeVisible();
    expect(screen.queryByLabelText('Senha inicial')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Criar acesso|Converter acesso|Trocar senha|Excluir/})).not.toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
  });
  it.each(['tenant', 'actor', 'permission'])('closes an open form after a %s context change', async change => {
    const rerender = show(); await openCreate(); fillCredentials();
    if (change === 'tenant') fixture.tenantId = 'tenant-b';
    if (change === 'actor') fixture.actorId = 'actor-b';
    if (change === 'permission') fixture.role = 'operator';
    rerender(); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(mutations()).toHaveLength(0);
  });
  it('does not inspect or open an access form for a driver outside the active tenant', async () => {
    fixture.foreign = true; show(); fireEvent.click(await screen.findByRole('button', { name: 'Criar acesso de Motorista A' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(fixture.invoke).not.toHaveBeenCalled();
  });
});

describe('independent-review recovery counterproofs', () => {
  async function confirmationBarrier() {
    expect(await screen.findByText(/solicitação de credenciais aguardando confirmação/)).toBeVisible();
    expect(screen.queryByLabelText('Usuário')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Senha inicial')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Confirmar senha')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Criar acesso'})).not.toBeInTheDocument();
    // The current barrier removes the form entirely, so there is no stale form to resubmit.
    expect(screen.getByRole('dialog').querySelector('form')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Verificar acesso'}));
    expect(mutations()).toHaveLength(1);
  }
  const driver = { id: 'driver-a', tenant_id: 'tenant-a', name: 'Motorista A', active: true, user_id: null };
  const alternate = { ...driver, id: 'driver-c', name: 'Motorista C' };
  function dialog() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
    const closed = vi.fn(); const ref = createRef<HTMLButtonElement>();
    const ui = (drivers = [driver, alternate]) => <QueryClientProvider client={client}><button ref={ref}>Retorno</button><CreateDriverAccessDialog tenantId={fixture.tenantId} actorId={fixture.actorId} drivers={drivers} returnFocusRef={ref} onClose={closed} /></QueryClientProvider>;
    const view = render(ui());
    return { client, closed, rerender: (drivers: typeof driver[]) => view.rerender(ui(drivers)) };
  }
  async function select() {
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Motorista A' }));
    await screen.findByLabelText('Usuário'); fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
  }
  it.each(['inactive', 'removed'])('keeps the send locked but releases safe exit after the target is %s', async mode => {
    fixture.holdCreate = true; const view = dialog(); await select();
    view.rerender(mode === 'inactive' ? [{ ...driver, active: false }, alternate] : [alternate]);
    expect(screen.queryByLabelText('Usuário')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(view.closed).not.toHaveBeenCalled();
    await act(async () => { fixture.finishCreate!(); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled());
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'false'); expect(screen.getByRole('combobox')).toBeEnabled();
    if (mode === 'inactive') fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    else fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(view.closed).toHaveBeenCalledTimes(1); expect(mutations()).toHaveLength(1);
    expect(mutations()[0][1].body).toMatchObject({ tenant_id: 'tenant-a', driver_id: 'driver-a' });
  });
  it('allows safe exit while inspection remains pending after the write settled', async () => {
    fixture.holdCreate = true; const view = dialog(); await select(); fixture.holdInspection = true;
    await act(async () => { fixture.finishCreate!(); });
    await waitFor(() => expect(fixture.finishInspection).not.toBeNull());
    view.rerender([alternate]); expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' })); expect(view.closed).toHaveBeenCalledTimes(1);
    await act(async () => { fixture.finishInspection!(); }); expect(mutations()).toHaveLength(1);
  });
  it('does not let an old completion close or unlock a new actor/tenant operation', async () => {
    fixture.holdCreate = true; const view = dialog(); await select();
    fixture.tenantId = 'tenant-b'; fixture.actorId = 'actor-b';
    view.rerender([{ ...driver, tenant_id: 'tenant-b' }]);
    expect(screen.queryByLabelText('Usuário')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
    await act(async () => { fixture.finishCreate!(); });
    expect(view.closed).not.toHaveBeenCalled(); expect(mutations()).toHaveLength(1);
    expect(mutations()[0][1].body).toMatchObject({ tenant_id: 'tenant-a', driver_id: 'driver-a' });
  });
  it.each(['same-context', 'context-return'])('blocks stale none through close/reopen offline and recovers on reconnect: %s', async mode => {
    fixture.loseResponse = true; fixture.offline = true; const view = show(); await openCreate(); fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await confirmationBarrier();
    const query = view.client.getQueryCache().find({ queryKey: ['driver_access'], exact: false })!;
    expect(query.state.fetchStatus).toBe('paused'); expect(query.state.data).toMatchObject({ kind: 'none' });
    expect(mutations()).toHaveLength(1); expect(fixture.kind).toBe('managed');
    expect(mutations()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    if (mode === 'context-return') {
      fixture.actorId = 'actor-b'; fixture.tenantId = 'tenant-b'; view();
      fixture.actorId = 'actor-a'; fixture.tenantId = 'tenant-a'; view();
    }
    fireEvent.click(await screen.findByRole('button', { name: 'Criar acesso de Motorista A' }));
    await confirmationBarrier();
    await act(async () => { onlineManager.setOnline(true); });
    expect(await screen.findByLabelText('Nova senha')).toHaveValue(''); expect(screen.queryByRole('button', { name: 'Criar acesso' })).not.toBeInTheDocument();
    expect(mutations()).toHaveLength(1);
  });
  it('requires a fresh successful none inspection before an explicit retry after a refused offline request', async () => {
    fixture.failCreate = true; const original = fixture.invoke.getMockImplementation()!;
    fixture.invoke.mockImplementation(async (...args) => { const result = await original(...args); if (args[1].body.action === 'create') onlineManager.setOnline(false); return result; });
    show(); await openCreate(); fillCredentials(); fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await confirmationBarrier();
    fixture.inspectError = true; await act(async () => { onlineManager.setOnline(true); });
    await screen.findByText('Inspeção indisponível na fixture.'); expect(screen.queryByRole('button', { name: 'Criar acesso' })).not.toBeInTheDocument();
    fixture.inspectError = false; fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByLabelText('Senha inicial'); fillCredentials();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar acesso' })).toBeEnabled());
    expect(mutations()).toHaveLength(1); expect(fixture.kind).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'Criar acesso' })); await waitFor(() => expect(mutations()).toHaveLength(2));
  });
});
