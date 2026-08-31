import { describe,expect,it } from 'vitest';
import { isConfirmedLoadTransition,isConfirmedTripStart,tripMutationError } from '@/lib/tripMutation';

describe('trip mutation response boundaries',()=>{
  it.each([null,{}, {trip_id:'other',status:'in_transit',load_ids:['load']},
    {trip_id:'trip',status:'planned',load_ids:['load']},{trip_id:'trip',status:'in_transit',load_ids:[]},
    {trip_id:'trip',status:'in_transit',load_ids:[null]}])('rejects an unconfirmed start: %j',data=>{
    expect(isConfirmedTripStart(data,'trip')).toBe(false);
  });
  it('accepts the current production start response without requiring the new changed field',()=>{
    expect(isConfirmedTripStart({trip_id:'trip',status:'in_transit',load_ids:['load']},'trip')).toBe(true);
  });
  it('rejects a transition response without an explicit changed boolean',()=>{
    expect(isConfirmedLoadTransition({load_id:'load',from_status:'ready',to_status:'loaded'},'load','loaded')).toBe(false);
  });
  it.each(['trip_start_requires_reconciliation','trip_load_assignment_mismatch','load_already_assigned_to_active_trip',
    'trip_must_be_started_before_load'])('translates %s without losing the SQL code',message=>{
    const error=tripMutationError({code:'23514',message});expect(error.code).toBe('23514');expect(error.message).not.toContain(message);
  });
});
