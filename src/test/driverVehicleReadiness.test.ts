import {expect,it} from 'vitest';
import {preChecklistProgress,vehicleReadinessAnswers} from '@/lib/driverVehicleReadiness';
const payload={schema_version:2,checklist_model:'vehicle_readiness_v1',checked_items:[0,1,2,3,4,5],total_items:6,answers:[true,false,true,true,true,true]};
it('accepts a fully answered checklist with a reported problem without labelling it all OK',()=>{
 expect(preChecklistProgress(payload)).toMatchObject({complete:true,total:6,answers:[true,false,true,true,true,true]});
 expect(vehicleReadinessAnswers(payload)?.[1]).toBe(false);
});
it('retains completed legacy eight-item records and rejects partial, duplicate and malformed modern answers',()=>{
 expect(preChecklistProgress({checked_items:[0,1,2,3,4,5,6,7]}).complete).toBe(true);
 expect(preChecklistProgress({checked_items:[0,1,2,3,4,5]}).complete).toBe(false);
 for(const changed of [{answers:[true,null,true,true,true,true]},{checked_items:[0,1,2,3,4,4]},{schema_version:3},
  {answers:['true',false,true,true,true,true]},{total_items:8},{checklist_model:'unknown'}]){
  expect(preChecklistProgress({...payload,...changed}).complete).toBe(false);
 }
});
