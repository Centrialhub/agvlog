import {readFileSync} from 'node:fs';
import {createTripCancellationDatabase,seedPlannedCancellationTrip} from './tripCancellationDatabase';
export async function createTripMaterializedCorrectionDatabase(){
 const db=await createTripCancellationDatabase();
 await db.exec(readFileSync('supabase/migrations/20260914201830_planned_trip_cancellation_public_boundary.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260914215310_audited_materialized_trip_correction.sql','utf8'));
 return db;
}
export async function seedMaterializedCorrectionTrip(db:Awaited<ReturnType<typeof createTripMaterializedCorrectionDatabase>>){
 const source=await seedPlannedCancellationTrip(db),completed=crypto.randomUUID();
 await db.query("update dispatch_trips set status='in_transit',actual_start_at='2026-09-14T12:00:00Z' where id=$1",[source.trip]);
 await db.query('update loads set trip_id=$1 where id=$2',[source.trip,source.load]);
 await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status,actual_arrival_at,actual_departure_at) values($1,$2,$3,'completed','2026-09-14T13:00:00Z','2026-09-14T13:30:00Z')",[completed,source.tenant,source.trip]);
 return {...source,completed};
}
