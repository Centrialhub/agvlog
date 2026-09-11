import type {PGlite} from '@electric-sql/pglite';

interface DeliveryReceiptEmailHistoryIds {tenant:string;user:string;driver:string;vehicle:string;trip:string}

export async function seedDeliveryReceiptEmailHistory(db:PGlite,ids:DeliveryReceiptEmailHistoryIds){
  const receipt='94000000-0000-4000-8000-000000000099',stop='82000000-0000-4000-8000-000000000098';
  const event='83000000-0000-4000-8000-000000000098';
  await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status,destination) values($1,$2,$3,'arrived','Destino histórico')",[stop,ids.tenant,ids.trip]);
  await db.query("insert into dispatch_events values($1,$2,$3,$4,'delivery_delivered',now(),$5)",[event,ids.tenant,ids.trip,stop,ids.user]);
  await db.query(`insert into delivery_receipts(id,tenant_id,delivery_event_id,dispatch_trip_id,dispatch_stop_id,driver_id,vehicle_id,
    digital_status,pdf_path,delivered_at,created_by) values($1,$2,$3,$4,$5,$6,$7,'validated','tenant/history/source.pdf',now(),$8)`,
    [receipt,ids.tenant,event,ids.trip,stop,ids.driver,ids.vehicle,ids.user]);
  await db.query(`insert into delivery_receipt_email_batches(id,tenant_id,supplier_key,supplier_name,receipt_ids,recipients,subject,body_text,status,created_by,created_at)
    select gen_random_uuid(),$1,'tax:00123456000100','Fornecedor Histórico '||value,array[$2]::uuid[],array['fiscal@fornecedor.test'],
      'Canhotos históricos','Segue comprovante.','bounced',$3,clock_timestamp()+value*interval '1 second' from generate_series(1,30) value`,
    [ids.tenant,receipt,ids.user]);
  const batch=(await db.query<{id:string}>("select id from delivery_receipt_email_batches where supplier_name='Fornecedor Histórico 30'")).rows[0].id;
  await db.query(`insert into delivery_receipt_email_items(batch_id,tenant_id,receipt_id,pdf_path,file_name,document_snapshot)
    values($1,$2,$3,'tenant/history/canhoto.pdf','CANHOTO_NF-HIST-777.pdf',$4::jsonb)`,
    [batch,ids.tenant,receipt,JSON.stringify([{kind:'nfse',number:'NF-HIST-777'}])]);
  return {batch};
}
