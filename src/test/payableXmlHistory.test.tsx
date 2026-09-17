import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PayableXmlHistory} from '@/components/financial/PayableXmlHistory';

const mock=vi.hoisted(()=>({read:vi.fn(),locator:vi.fn(),signed:vi.fn()}));
vi.mock('@/lib/financial/payableXmlClient',()=>({readPayableXmlContext:mock.read,getPayableXmlLocator:mock.locator}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{storage:{from:()=>({createSignedUrl:mock.signed})}}}));
const tenant='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',payable='33333333-3333-4333-8333-333333333333',link='44444444-4444-4444-8444-444444444444';
beforeEach(()=>{mock.read.mockResolvedValue({rows:[{link_id:link,actor_id:actor,created_at:'2026-09-17T12:00:00Z',artifact:{sha256:'a'.repeat(64),summary:{emitter_name:'Fornecedor',document_number:'10',series:'1',amount_cents:'1000',access_key:'1'.repeat(44)}}}],total:1,next_offset:null,history_revision:'a'.repeat(32)});});
afterEach(()=>{cleanup();vi.restoreAllMocks();Object.values(mock).forEach(value=>value.mockReset());});
function show(){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PayableXmlHistory tenant={tenant} actor={actor} payableId={payable}/></QueryClientProvider>);fireEvent.click(screen.getByText('Conferir XMLs preservados'));}
it('reports a blocked popup before requesting a signed URL',async()=>{vi.spyOn(window,'open').mockReturnValue(null);show();fireEvent.click(await screen.findByText('Baixar XML original'));expect(await screen.findByRole('alert')).toHaveTextContent('bloqueou a nova aba');expect(mock.locator).not.toHaveBeenCalled();expect(mock.signed).not.toHaveBeenCalled();});
it('navigates the synchronously opened tab after signing the original',async()=>{const replace=vi.fn(),close=vi.fn(),popup={opener:window,location:{replace},close} as unknown as Window;vi.spyOn(window,'open').mockReturnValue(popup);mock.locator.mockResolvedValue({bucket:'payable-xml-quarantine',path:'private/original'});mock.signed.mockResolvedValue({data:{signedUrl:'https://example.invalid/original.xml'},error:null});show();fireEvent.click(await screen.findByText('Baixar XML original'));await vi.waitFor(()=>expect(replace).toHaveBeenCalledWith('https://example.invalid/original.xml'));expect(close).not.toHaveBeenCalled();expect(popup.opener).toBeNull();});
