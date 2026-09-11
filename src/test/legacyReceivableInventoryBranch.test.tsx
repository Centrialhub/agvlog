import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,it,expect,vi} from 'vitest';
import {LegacyAdoptionInventory} from '@/components/financial/LegacyAdoptionInventory';
const read=vi.hoisted(()=>vi.fn());vi.mock('@/lib/financial/legacyInventoryClient',()=>({readLegacyInventory:read}));vi.mock('@/components/financial/LegacyReceivableAssociation',()=>({LegacyReceivableAssociation:({payment}:{payment:string})=><p>Associar recebimento {payment}</p>}));vi.mock('@/components/financial/LegacyPayableAssociation',()=>({LegacyPayableAssociation:()=>null}));afterEach(cleanup);
it('offers association for receivables_payments only, without inferring missing receipt IDs in load or closing records',async()=>{
 const sources=['receivables_payments','closing_report_payments','load_payments','receivable_payment_reversals'];read.mockResolvedValue({total:4,rows:sources.map(source=>({source_table:source,source_id:source,occurred_on:'2026-01-10',amount_cents:'50000',direction:'in',reason:'receipt_without_canonical_link'})),unknown_account:{total:0,rows:[]}});render(<QueryClientProvider client={new QueryClient()}><LegacyAdoptionInventory tenant="tenant" actor="actor" account="account" from="2026-01-01" to="2026-01-31"/></QueryClientProvider>);fireEvent.click(screen.getByRole('button',{name:'Consultar registros antigos'}));expect(await screen.findByText('Associar recebimento receivables_payments')).toBeInTheDocument();expect(screen.getAllByText(/Associar recebimento/)).toHaveLength(1);
});
