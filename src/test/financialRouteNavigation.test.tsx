import type {ReactNode} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter,Link,Route,Routes} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import {ProtectedRoute} from '@/app/routeGuards';
import {FinanceUnavailableError} from '@/lib/financial/ledgerClient';
const state=vi.hoisted(()=>({role:'operator',allowed:true,fresh:true,error:null as Error|null,refetch:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'},loading:false})}));
vi.mock('@/hooks/useTenant',()=>({TenantProvider:({children}:{children:ReactNode})=>children,useTenant:()=>({currentRole:state.role,loading:false})}));
vi.mock('@/hooks/useTenantCapabilities',()=>({useTenantCapabilities:()=>({})}));
vi.mock('@/hooks/useFinanceLedger',()=>({useFinanceAccess:()=>({data:state.allowed,isFetchedAfterMount:state.fresh,error:state.error,isPending:false,refetch:state.refetch})}));
vi.mock('@/components/layout/AppLayout',()=>({default:({children}:{children:ReactNode})=><><nav aria-label="Menu principal"><Link to="/trips">Viagens</Link></nav><main>{children}</main></>}));
vi.mock('@/components/layout/DriverLayout',()=>({default:({children}:{children:ReactNode})=><main>{children}</main>}));
vi.mock('@/pages/Auth',()=>({default:()=>null}));
vi.mock('@/components/integrations/IntegrationUnavailable',()=>({IntegrationUnavailable:()=>null}));
const mounted=vi.fn();function Financial(){mounted();return <p>Dados financeiros privados</p>;}
function show(){return render(<MemoryRouter initialEntries={['/financial']}><Routes><Route path="/financial" element={<ProtectedRoute><Financial/></ProtectedRoute>}/><Route path="/trips" element={<p>Viagens abertas</p>}/><Route path="/driver" element={<p>Área do motorista</p>}/></Routes></MemoryRouter>);}
afterEach(()=>{cleanup();state.role='operator';state.allowed=true;state.fresh=true;state.error=null;mounted.mockClear();state.refetch.mockClear();});
it('keeps navigation available when the access endpoint is absent without mounting financial data',()=>{state.error=new FinanceUnavailableError();show();expect(screen.getByRole('alert')).toHaveTextContent('ainda não está disponível neste ambiente');expect(mounted).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Tentar novamente'));expect(state.refetch).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('link',{name:'Viagens'}));expect(screen.getByText('Viagens abertas')).toBeInTheDocument();});
it('keeps the menu on network error without substituting an authorization decision',()=>{state.error=Error('network');show();expect(screen.getByRole('navigation')).toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível confirmar');expect(mounted).not.toHaveBeenCalled();});
it('keeps sensitive content unmounted for cached access and mixed-role denial',()=>{state.fresh=false;const view=show();expect(mounted).not.toHaveBeenCalled();expect(screen.getByRole('navigation')).toBeInTheDocument();view.unmount();state.fresh=true;state.role='admin';state.allowed=false;show();expect(screen.getByRole('alert')).toHaveTextContent('não permitido');expect(mounted).not.toHaveBeenCalled();});
it('redirects a driver away from the internal financial route',()=>{state.role='driver';show();expect(screen.getByText('Área do motorista')).toBeInTheDocument();expect(mounted).not.toHaveBeenCalled();});
