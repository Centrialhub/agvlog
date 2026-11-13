import {driverTripNeedsReconciliation,isDriverTripStarted} from './driverTrip';
import {TRIP_ACTIVE_STATUSES} from './status';
interface EntryTrip {id:string;tenant_id?:string;status?:string|null;actual_start_at?:string|null;loads?:{status?:string|null}|null}
export function driverEntryPath(trip:EntryTrip,tenantId:string,checklistComplete:boolean,sharedJourney=false):string|null{
 if(sharedJourney||trip.tenant_id!==tenantId||!trip.status||!(TRIP_ACTIVE_STATUSES as readonly string[]).includes(trip.status)
  ||driverTripNeedsReconciliation(trip.status,trip.actual_start_at,trip.loads?.status))return null;
 const id=encodeURIComponent(trip.id);
 return isDriverTripStarted(trip.status,trip.actual_start_at)?`/driver/stops?trip=${id}`
  :checklistComplete?`/driver/cargo?trip=${id}`:`/driver/checklist?trip=${id}&welcome=1`;
}
