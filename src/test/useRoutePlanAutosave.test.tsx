import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {useRoutePlanAutosave} from '@/hooks/route-planning/useRoutePlanAutosave';
import {DraftConflictError,type useSavePlanSnapshot} from '@/hooks/useRoutePlanningDrafts';
import type {PendingDispatch} from '@/lib/route-planning/dispatchOutbox';

const route={id:'route',name:'Route',loads:[{id:'load'}],driver_id:'driver',vehicle_id:'vehicle',notes:'Nota operacional'};
let mutate:ReturnType<typeof vi.fn>;let forget:ReturnType<typeof vi.fn>;let conflict:ReturnType<typeof vi.fn>;
let saver:ReturnType<typeof useSavePlanSnapshot>;
beforeEach(()=>{vi.useFakeTimers();mutate=vi.fn();forget=vi.fn();conflict=vi.fn();
  saver={mutate,forgetVersion:forget} as unknown as ReturnType<typeof useSavePlanSnapshot>;});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('route autosave lifecycle',()=>{
  it('does not persist before draft hydration',()=>{
    renderHook(()=>useRoutePlanAutosave([route],[],{current:false},saver,conflict));act(()=>vi.advanceTimersByTime(2000));
    expect(mutate).not.toHaveBeenCalled();
  });
  it('debounces and preserves canonical load IDs and edited fields',()=>{
    renderHook(()=>useRoutePlanAutosave([route],[],{current:true},saver,conflict));act(()=>vi.advanceTimersByTime(1499));
    expect(mutate).not.toHaveBeenCalled();act(()=>vi.advanceTimersByTime(1));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({routeId:'route',snapshot:expect.objectContaining({
      loads:[{id:'load'}],load_ids:['load'],notes:'Nota operacional',driver_id:'driver',vehicle_id:'vehicle',
    })}),expect.any(Object));
  });
  it('cancels scheduled persistence when dispatch starts',()=>{
    const ready={current:true};const pending:PendingDispatch[]=[];
    const {rerender}=renderHook(({dispatching})=>useRoutePlanAutosave([{...route,dispatching}],pending,ready,saver,conflict),{initialProps:{dispatching:false}});
    act(()=>vi.advanceTimersByTime(1000));rerender({dispatching:true});act(()=>vi.advanceTimersByTime(2000));expect(mutate).not.toHaveBeenCalled();
  });
  it('does not overwrite a route whose dispatch result is unknown',()=>{
    renderHook(()=>useRoutePlanAutosave([route],[{scope:'route'} as PendingDispatch],{current:true},saver,conflict));
    act(()=>vi.advanceTimersByTime(2000));expect(mutate).not.toHaveBeenCalled();
  });
  it('does not recreate a route while its CAS deletion is being confirmed',()=>{
    renderHook(()=>useRoutePlanAutosave([{...route,deleting:true}],[],{current:true},saver,conflict));
    act(()=>vi.advanceTimersByTime(2000));expect(mutate).not.toHaveBeenCalled();
  });
  it('reports a conditional-write conflict and forgets only the affected version',()=>{
    renderHook(()=>useRoutePlanAutosave([route],[],{current:true},saver,conflict));act(()=>vi.advanceTimersByTime(1500));
    act(()=>mutate.mock.calls[0][1].onError(new DraftConflictError('route','old','new')));
    expect(forget).toHaveBeenCalledWith('route');expect(conflict).toHaveBeenCalledTimes(1);
  });
});
