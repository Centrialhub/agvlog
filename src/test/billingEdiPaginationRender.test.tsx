import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import BillingEdi from '@/pages/BillingEdi';
const mocks=vi.hoisted(()=>({eligible:vi.fn(),history:vi.fn()}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant',name:'Empresa'}})}));
vi.mock('@/hooks/useClients',()=>({useClients:()=>({data:[]})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:vi.fn(),error:vi.fn()})}));
vi.mock('@/hooks/useBillingEdi',()=>({
 useEdiProfiles:()=>({data:[]}),useEdiExports:(page:number)=>{mocks.history(page);return {data:{rows:[],total:60}};},
 useEligibleInvoicesForEdi:(filters:unknown,page:number)=>{mocks.eligible(filters,page);return {data:{rows:[],total:60},refetch:vi.fn()};},
 useMarkEdiSent:()=>({}),useMarkEdiDownloaded:()=>({}),useCancelEdiExport:()=>({}),
 EDI_HISTORY_PAGE_SIZE:30,EDI_ELIGIBLE_PAGE_SIZE:30,
}));
it('renders and paginates eligible invoices and history without an undefined component',async()=>{
 render(<BillingEdi/>);fireEvent.click(screen.getByRole('button',{name:'Próxima página'}));await waitFor(()=>expect(mocks.eligible).toHaveBeenLastCalledWith(expect.anything(),2));
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Histórico'}),{button:0,ctrlKey:false});
 fireEvent.click(await screen.findByRole('button',{name:'Próxima página'}));await waitFor(()=>expect(mocks.history).toHaveBeenLastCalledWith(2));
});
