import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createDeliverySubmission, deliveryOutcome, invalidateDeliveryQueries, replayPendingDeliverySubmissions, type DeliverySubmissionInput } from '@/lib/driver/driverDeliverySubmission';
const mocks = vi.hoisted(() => ({rpc:vi.fn(),upload:vi.fn(),remove:vi.fn()}));
vi.mock('@/integrations/supabase/client', () => ({supabase:{rpc:mocks.rpc}}));
vi.mock('@/lib/secureUpload', () => ({uploadSecureFile:mocks.upload,removeSecureFiles:mocks.remove}));
const result = {event_id:'10000000-0000-4000-8000-000000000001',operational_event_id:'20000000-0000-4000-8000-000000000001',replayed:false};
const file = () => new File([new Uint8Array(16)],'photo.png',{type:'image/png'});
const input = (): DeliverySubmissionInput => ({tenantId:'tenant',actorId:'driver-user',tripId:'trip',stopId:'stop',expectedStatus:'arrived',eventKey:'entregue',
  photos:[file()],signatureDataUrl:'data:image/png;base64,AA==',details:{receiver_name:'Recebedor',notes:'Entregue'}});
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.rpc.mockResolvedValue({data:result,error:null}); mocks.upload.mockResolvedValue('tenant/path.png'); mocks.remove.mockResolvedValue(undefined);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({blob:async () => new Blob([new Uint8Array(16)],{type:'image/png'})}));
});

describe('delivery frontend submission contract', () => {
  it('calls one atomic RPC with proofs, receiver and stable request id', async () => {
    const attempt=createDeliverySubmission(input()); await attempt.submit();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('driver_record_delivery_outcome',expect.objectContaining({_stop_id:'stop',_outcome:'delivered',
      _client_event_id:expect.any(String),_expected_status:'arrived',_details:expect.objectContaining({receiver_name:'Recebedor',photo_paths:['tenant/path.png']})}));
    expect(mocks.upload).toHaveBeenCalledTimes(2); expect(attempt.dispatched).toBe(true);
  });
  it('retries a lost response with identical payload, key and uploads', async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'Network lost'}});
    const draft=input(); const attempt=createDeliverySubmission(draft);
    await expect(attempt.submit()).rejects.toMatchObject({message:'Network lost'});
    draft.details.receiver_name='Changed'; draft.photos.push(file());
    await attempt.submit();
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0]);
    expect(mocks.upload).toHaveBeenCalledTimes(2); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('replays an uncertain submission after a page reload without reuploading evidence', async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'Network lost'}});
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).rejects.toMatchObject({message:'Network lost'});
    const firstCall=mocks.rpc.mock.calls[0];
    expect(localStorage.length).toBe(1);
    mocks.rpc.mockResolvedValueOnce({data:{...result,replayed:true},error:null});
    await expect(replayPendingDeliverySubmissions('tenant','driver-user')).resolves.toEqual({confirmed:1,cleaned:0});
    expect(mocks.rpc.mock.calls[1]).toEqual(firstCall);
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
  });
  it('does not replay another actor or tenant outbox', async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'Network lost'}});
    await expect(createDeliverySubmission(input()).submit()).rejects.toBeTruthy();
    await expect(replayPendingDeliverySubmissions('tenant','other-driver')).resolves.toEqual({confirmed:0,cleaned:0});
    await expect(replayPendingDeliverySubmissions('other-tenant','driver-user')).resolves.toEqual({confirmed:0,cleaned:0});
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(1);
  });
  it('deduplicates concurrent button submissions', async () => {
    const attempt=createDeliverySubmission(input()); const first=attempt.submit(); const second=attempt.submit();
    expect(first).toBe(second); await Promise.all([first,second]); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['22023','23514','40001','40P01','42501','P0002'])('unlocks a confirmed %s rejection after cleaning uncommitted uploads', async code => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code,message:'Envio rejeitado'}});
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).rejects.toMatchObject({code});
    expect(attempt.canRevise).toBe(true);
    expect(mocks.remove).toHaveBeenCalledWith('tenant','receipts',['tenant/path.png','tenant/path.png']);
  });
  it.each(['23505','PGRST000','',undefined])('keeps an unclassified %s response immutable', async code => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code,message:'Resultado incerto'}});
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).rejects.toMatchObject({message:'Resultado incerto'});
    expect(attempt.canRevise).toBe(false); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('does not erase evidence after a lost response followed by a validation rejection', async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'Resposta perdida'}})
      .mockResolvedValueOnce({data:null,error:{code:'23514',message:'Parada já encerrada'}});
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).rejects.toBeTruthy();
    await expect(attempt.submit()).rejects.toBeTruthy();
    expect(attempt.canRevise).toBe(false); expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0]);
  });
  it('keeps an exception from transport uncertain even if the retry is rejected', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('Conexão interrompida'))
      .mockResolvedValueOnce({data:null,error:{code:'42501',message:'Sessão expirada'}});
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).rejects.toThrow('Conexão interrompida');
    await expect(attempt.submit()).rejects.toBeTruthy();
    expect(attempt.canRevise).toBe(false); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('retries failed cleanup before uploading again, retaining the rejected request id', async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'23514',message:'Envio rejeitado'}});
    mocks.remove.mockRejectedValueOnce(new Error('Limpeza indisponível'));
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).rejects.toThrow('anexos pendentes de limpeza');
    expect(attempt.canRevise).toBe(false);
    await attempt.submit();
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.upload).toHaveBeenCalledTimes(4);
    expect(mocks.remove.mock.invocationCallOrder[1]).toBeLessThan(mocks.upload.mock.invocationCallOrder[2]);
    expect(mocks.rpc.mock.calls[1][1]._client_event_id).toBe(mocks.rpc.mock.calls[0][1]._client_event_id);
  });
  it('never removes potentially committed evidence on a malformed success response', async () => {
    mocks.rpc.mockResolvedValue({data:{},error:null});
    await expect(createDeliverySubmission(input()).submit()).rejects.toThrow();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('cleans partial photo uploads before any RPC and keeps submission editable', async () => {
    mocks.upload.mockResolvedValueOnce('first.png').mockRejectedValueOnce(new Error('upload failed'));
    const attempt=createDeliverySubmission({...input(),photos:[file(),file()]});
    await expect(attempt.submit()).rejects.toThrow('upload failed');
    expect(mocks.remove).toHaveBeenCalledWith('tenant','receipts',['first.png']);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(attempt.dispatched).toBe(false);
  });
  it('cleans photos when signature upload fails and reports cleanup failures', async () => {
    mocks.upload.mockResolvedValueOnce('first.png').mockRejectedValueOnce(new Error('signature failed'));
    mocks.remove.mockRejectedValue(new Error('cleanup failed'));
    await expect(createDeliverySubmission(input()).submit()).rejects.toThrow('anexos pendentes de limpeza');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['entregue','devolucao_parcial'])('requires signature and photo for %s before uploading', eventKey => {
    expect(() => createDeliverySubmission({...input(),eventKey,photos:[]})).toThrow('foto e assinatura');
    expect(() => createDeliverySubmission({...input(),eventKey,signatureDataUrl:null})).toThrow('foto e assinatura');
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it.each(['devolucao_parcial','devolucao_total','cliente_recusou','cliente_estava_fora'])('routes %s directly to the outcome API', async eventKey => {
    const draft={...input(),eventKey}; await createDeliverySubmission(draft).submit();
    expect(mocks.rpc).toHaveBeenCalledWith('driver_record_delivery_outcome',expect.objectContaining({_outcome:deliveryOutcome(eventKey)}));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['avaria','solicitar_desconto','atualizar_boleto','coleta_realizada','outros'])('sends %s to operations, not a dispatch-only event', async eventKey => {
    await createDeliverySubmission({...input(),eventKey}).submit();
    expect(mocks.rpc).toHaveBeenCalledWith('driver_record_delivery_note',expect.objectContaining({_event_type:eventKey}));
  });
  it('invalidates interconnected load, trip, documents, driver and operations caches', async () => {
    const client=new QueryClient(); const spy=vi.spyOn(client,'invalidateQueries').mockResolvedValue();
    await invalidateDeliveryQueries(client);
    for (const key of ['driver_delivery_stops','driver_events','driver_active_trip','loads','fiscal_documents','operational_events','dispatch_trips',
      'load_documents','operation_document_context','driver_settlements','driver_settlement','portal_pods','portal_shipments','portal_shipment_detail_v2']) {
      expect(spy).toHaveBeenCalledWith({queryKey:[key]});
    }
    client.clear();
  });
  it('does not convert a committed delivery into a failure when one refresh rejects', async () => {
    const client=new QueryClient(); const spy=vi.spyOn(client,'invalidateQueries').mockRejectedValueOnce(new Error('Refresh unavailable')).mockResolvedValue();
    await expect(invalidateDeliveryQueries(client)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith({queryKey:['portal_shipment_detail_v2']});
    expect(spy).toHaveBeenCalledWith({queryKey:['driver_events']});
    client.clear();
  });
});
