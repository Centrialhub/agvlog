import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {DispatchDocumentAssignments,assignDispatchDocument} from '@/components/loads/DispatchDocumentAssignments';
const documents=Array.from({length:74},(_,n)=>({id:`d${n}`,label:`NF${n}`}));
const stops=Array.from({length:44},(_,n)=>({destination:`Destinatário ${n}`,fiscal_document_ids:documents.filter((_,i)=>i%44===n).map(d=>d.id)}));
it('74 notas mantêm a parada durante preparação e conclusão sem eventos de alteração ao montar',async()=>{
 const onAssign=vi.fn();const view=render(<DispatchDocumentAssignments stops={stops} documents={documents} disabled onAssign={onAssign}/>);
 expect(screen.getByText(/74 de 74/)).toBeInTheDocument();expect(screen.queryAllByRole('combobox')).toHaveLength(0);
 const details=screen.getByText(/74 de 74/).closest('details')!;details.open=true;fireEvent(details,new Event('toggle'));
 await waitFor(()=>expect(view.container.querySelectorAll('select')).toHaveLength(74));
 const selectors=Array.from(view.container.querySelectorAll('select'));
 for(let n=0;n<74;n++){expect(selectors[n]).toHaveAccessibleName(`Documento NF${n}`);expect(selectors[n]).toHaveValue(String(n%44));expect(selectors[n]).toBeDisabled();}
 view.rerender(<DispatchDocumentAssignments stops={stops.map(s=>({...s}))} documents={documents} disabled={false} onAssign={onAssign}/>);
 expect(onAssign).not.toHaveBeenCalled();expect(selectors[73]).toHaveValue('29');
 fireEvent.change(selectors[73],{target:{value:'0'}});expect(onAssign).toHaveBeenCalledExactlyOnceWith('d73','0');
});
it('ignora valor vazio/inválido e remaneja uma nota sem perder nem duplicar outras',()=>{
 for(const value of ['', 'unknown','-2','44','0.5'])expect(assignDispatchDocument(stops,'d73',value)).toBe(stops);
 const moved=assignDispatchDocument(stops,'d73','0');expect(moved[0].fiscal_document_ids).toContain('d73');expect(moved[29].fiscal_document_ids).not.toContain('d73');
 expect(moved.flatMap(s=>s.fiscal_document_ids).sort()).toEqual(documents.map(d=>d.id).sort());
 expect(assignDispatchDocument(stops,'d73','-1').flatMap(s=>s.fiscal_document_ids)).not.toContain('d73');
});
