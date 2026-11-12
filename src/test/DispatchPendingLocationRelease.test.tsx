import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {DispatchPendingLocationRelease} from '@/components/loads/DispatchPendingLocationRelease';
afterEach(cleanup);
it('requires an explicit operational release for fifty pending locations and sends one visible reason',()=>{
 const release=vi.fn();render(<DispatchPendingLocationRelease count={50} disabled={false} onRelease={release}/>);
 expect(release).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Liberar despacho sem ajustar o mapa'}));
 const reason=screen.getByLabelText('Justificativa da liberação das paradas pendentes') as HTMLTextAreaElement;
 expect(reason.value.length).toBeGreaterThanOrEqual(20);
 fireEvent.click(screen.getByRole('button',{name:'Autorizar despacho com 50 local(is) pendente(s)'}));
 expect(release).toHaveBeenCalledExactlyOnceWith(reason.value);
});
it('does not offer a release when there are no pending stops or while dispatch is in progress',()=>{
 const release=vi.fn();const view=render(<DispatchPendingLocationRelease count={0} disabled={false} onRelease={release}/>);
 expect(screen.queryByRole('button')).not.toBeInTheDocument();
 view.rerender(<DispatchPendingLocationRelease count={2} disabled onRelease={release}/>);
 expect(screen.getByRole('button')).toBeDisabled();expect(release).not.toHaveBeenCalled();
});
