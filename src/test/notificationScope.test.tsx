import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,render,renderHook,screen} from '@testing-library/react';
import {toast as sonner,type Action,type ToastT} from 'sonner';
import {useToast} from '@/hooks/use-toast';
import {useSonnerToast} from '@/hooks/useSonnerToast';
import {useAlertStore,useScopedAlerts} from '@/hooks/useAlertStore';
import {resetNotificationScope} from '@/lib/notificationScope';
import {ToastAction} from '@/components/ui/toast';
import {Toaster} from '@/components/ui/sonner';
afterEach(()=>{act(()=>resetNotificationScope());cleanup();vi.useRealTimers();});
const active=()=>sonner.getToasts() as ToastT[];
describe('notification context, not server command cancellation',()=>{
 it('keeps ordinary rerenders usable and invalidates old shadcn handles after replacement',()=>{
  const view=renderHook(useToast);const old=view.result.current.toast;let handle!:ReturnType<typeof old>;
  act(()=>{handle=old({title:'old private'});});view.rerender();expect(view.result.current.toasts[0].title).toBe('old private');
  act(()=>resetNotificationScope());expect(view.result.current.toasts).toHaveLength(0);
  act(()=>{view.result.current.toast({title:'new private'});old({title:'late old'});handle.update({id:handle.id,title:'late update'});handle.dismiss();});
  expect(view.result.current.toasts.map(t=>t.title)).toEqual(['new private']);
 });
 it('does not execute a saved shadcn action after its access context is gone',()=>{
  const write=vi.fn(),view=renderHook(useToast);
  act(()=>{view.result.current.toast({title:'private action',action:<ToastAction altText="Ação QA" onClick={write}>Ação QA</ToastAction>});});
  const callback=view.result.current.toasts[0].action!.props.onClick!;act(()=>resetNotificationScope());
  callback({} as Parameters<typeof callback>[0]);expect(write).not.toHaveBeenCalled();
 });
 it('preserves a current action when updating only the title of its toast',()=>{
  const action=vi.fn(),view=renderHook(useToast);let handle!:ReturnType<typeof view.result.current.toast>;
  act(()=>{handle=view.result.current.toast({title:'before',action:<ToastAction altText="Ação atual" onClick={action}>Ação atual</ToastAction>});handle.update({id:handle.id,title:'after'});});
  const callback=view.result.current.toasts[0].action!.props.onClick!;callback({} as Parameters<typeof callback>[0]);
  expect(view.result.current.toasts[0].title).toBe('after');expect(action).toHaveBeenCalledTimes(1);
 });
 it('keeps current Sonner updates working but blocks stale publish and dismiss handles',()=>{
  const view=renderHook(useSonnerToast),old=view.result.current;let id!:string|number;
  act(()=>{id=old.loading('loading private');expect(old.success('done private',{id})).toBe(id);});expect(active().find(t=>t.id===id)?.title).toBe('done private');
  act(()=>resetNotificationScope());expect(active()).toHaveLength(0);
  act(()=>{view.result.current.success('new context');old.error('late error');old.success('late success',{id});old.dismiss();});
  expect(active().map(t=>t.title)).toEqual(['new context']);expect(useAlertStore.getState().isOpen).toBe(false);
 });
 it('removes an old loading notice when the current response becomes an error dialog',()=>{
  const view=renderHook(useSonnerToast);act(()=>{const id=view.result.current.loading('loading QA');view.result.current.error('failed QA',{id,description:'Error context QA'});});
  expect(active()).toHaveLength(0);expect(useAlertStore.getState()).toMatchObject({title:'failed QA',description:'Error context QA',isOpen:true});
 });
 it('scrubs private text and callbacks from SDK history, including previously dismissed notices',()=>{
  const view=renderHook(useSonnerToast);let id!:string|number;
  act(()=>{id=view.result.current.success('PRIVATE_HISTORY_QA',{description:'PRIVATE_DESCRIPTION_QA',action:{label:'PRIVATE_ACTION_QA',onClick:vi.fn()}});view.result.current.dismiss(id);});
  expect(active()).toHaveLength(0);expect(JSON.stringify(sonner.getHistory())).toContain('PRIVATE_HISTORY_QA');
  act(()=>resetNotificationScope());const history=sonner.getHistory() as ToastT[];
  expect(JSON.stringify(history)).not.toMatch(/PRIVATE_(HISTORY|DESCRIPTION|ACTION)_QA/);
  expect(history.find(t=>t.id===id)).toMatchObject({title:'',description:undefined,action:undefined,onDismiss:undefined,onAutoClose:undefined});
 });
 it('guards saved Sonner actions and dismiss callbacks',()=>{
  const action=vi.fn(),dismiss=vi.fn(),view=renderHook(useSonnerToast);let id!:string|number;
  act(()=>{id=view.result.current.success('private action',{action:{label:'Confirmar',onClick:action},onDismiss:dismiss});});
  const old=active().find(t=>t.id===id)!;act(()=>resetNotificationScope());(old.action as Action).onClick({} as Parameters<Action['onClick']>[0]);old.onDismiss?.(old);
  expect(action).not.toHaveBeenCalled();expect(dismiss).not.toHaveBeenCalled();
 });
 it('does not revive an internally scheduled Sonner render after remounting the context',async()=>{
  vi.useFakeTimers();let notify!:ReturnType<typeof useSonnerToast>;
  function Host(){notify=useSonnerToast();return <Toaster/>;}render(<Host/>);
  act(()=>{notify.success('queued old private');resetNotificationScope();});await act(async()=>{await vi.advanceTimersByTimeAsync(50);});
  expect(screen.queryByText('queued old private')).not.toBeInTheDocument();expect(active()).toHaveLength(0);
 });
 it('rejects late confirmation, prompt and alert creation without opening a dialog',async()=>{
  const view=renderHook(useScopedAlerts),old=view.result.current;act(()=>resetNotificationScope());
  await expect(old.confirmAction('late confirm')).resolves.toBe(false);await expect(old.promptAction('late prompt')).resolves.toBeNull();
  act(()=>old.showAlert('late alert'));expect(useAlertStore.getState().isOpen).toBe(false);
 });
 it('resolves pending confirmation negatively on replacement and ignores saved fiscal callbacks',async()=>{
  const view=renderHook(useScopedAlerts);let pending!:Promise<boolean>;
  act(()=>{pending=view.result.current.confirmAction('pending confirm');});act(()=>resetNotificationScope());await expect(pending).resolves.toBe(false);
  const transmit=vi.fn();act(()=>view.result.current.showAlert('fiscal QA','context QA','warning',{onConfirm:transmit,onSecondaryConfirm:transmit}));
  const old=useAlertStore.getState();act(()=>resetNotificationScope());old.onConfirm?.();old.onSecondaryConfirm?.();expect(transmit).not.toHaveBeenCalled();
 });
 it('does not accept a confirmation resolved immediately before context replacement',async()=>{
  const view=renderHook(useScopedAlerts);let pending!:Promise<boolean>;
  act(()=>{pending=view.result.current.confirmAction('confirm QA');useAlertStore.getState().onConfirm?.();resetNotificationScope();});
  await expect(pending).resolves.toBe(false);
 });
 it('keeps confirmation and prompt usable in the current context',async()=>{
  const view=renderHook(useScopedAlerts);let confirm!:Promise<boolean>,prompt!:Promise<string|null>;
  act(()=>{confirm=view.result.current.confirmAction('confirm current');useAlertStore.getState().onConfirm?.();});await expect(confirm).resolves.toBe(true);
  act(()=>{prompt=view.result.current.promptAction('reason current');useAlertStore.getState().onConfirm?.(' reason ');});await expect(prompt).resolves.toBe('reason');
 });
});
