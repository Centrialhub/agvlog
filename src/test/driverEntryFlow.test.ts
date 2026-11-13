import {expect,it} from 'vitest';
import {driverEntryPath} from '@/lib/driverEntryFlow';
const trip={id:'trip',tenant_id:'tenant',status:'dispatched',actual_start_at:null,loads:{status:'loaded'}};
it('goes directly to the welcome checklist and then cargo without starting the journey',()=>{
 expect(driverEntryPath(trip,'tenant',false)).toBe('/driver/checklist?trip=trip&welcome=1');
 expect(driverEntryPath(trip,'tenant',true)).toBe('/driver/cargo?trip=trip');
 expect(driverEntryPath({...trip,status:'in_transit',actual_start_at:'2026-11-13T10:00:00Z',loads:{status:'in_transit'}},'tenant',false))
  .toBe('/driver/stops?trip=trip');
});
it('does not guess a tenant, shared physical journey or inconsistent/terminal trip',()=>{
 expect(driverEntryPath(trip,'other',false)).toBeNull();expect(driverEntryPath(trip,'tenant',false,true)).toBeNull();
 expect(driverEntryPath({...trip,loads:{status:'in_transit'}},'tenant',false)).toBeNull();
 expect(driverEntryPath({...trip,status:'cancelled'},'tenant',false)).toBeNull();
});
