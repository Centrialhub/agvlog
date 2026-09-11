import { describe,expect,it } from 'vitest';
import { createMemoryDriverOfflineOutbox,driverOfflineScope,type DriverOfflineEnvelope } from '@/lib/driver/driverOfflineOutbox';
import type { Json } from '@/integrations/supabase/types';

const record=(overrides:Partial<DriverOfflineEnvelope<Json>>={}):DriverOfflineEnvelope<Json>=>({
  version:1,id:crypto.randomUUID(),scopeKey:driverOfflineScope('tenant-a','actor-a'),tenantId:'tenant-a',actorId:'actor-a',
  kind:'delivery',aggregateId:'trip-a',state:'queued',payload:{stop_id:'stop-a'},files:[],attempts:0,lastError:null,
  createdAt:'2026-09-10T12:00:00.000Z',updatedAt:'2026-09-10T12:00:00.000Z',...overrides,
});

describe('unified driver offline outbox',()=>{
  it('isolates commands by tenant, actor and kind',async()=>{
    const store=createMemoryDriverOfflineOutbox(),delivery=record(),expense=record({id:crypto.randomUUID(),kind:'expense'});
    await store.put(delivery);await store.put(expense);
    expect(await store.list('tenant-a','actor-a','delivery')).toEqual([delivery]);
    expect(await store.list('tenant-a','actor-b')).toEqual([]);
  });

  it('updates retry state atomically and removes only after confirmation',async()=>{
    const store=createMemoryDriverOfflineOutbox(),queued=record();await store.put(queued);
    const updated=await store.update<Json>(queued.id,current=>({...current,state:'syncing',attempts:1,
      updatedAt:'2026-09-10T12:01:00.000Z'}));
    expect(updated).toMatchObject({state:'syncing',attempts:1});
    await store.remove(queued.id);expect(await store.list('tenant-a','actor-a')).toEqual([]);
  });

  it('rejects an envelope whose scope does not match its session',async()=>{
    const store=createMemoryDriverOfflineOutbox();
    await expect(store.put(record({scopeKey:'tenant-b:actor-a'}))).rejects.toThrow('comando offline é inválido');
  });
});
