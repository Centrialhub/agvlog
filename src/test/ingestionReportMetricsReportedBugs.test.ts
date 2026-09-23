import { describe, expect, it } from 'vitest';
import { buildIngestionReport } from '@/lib/ingestion/report';

function doc(overrides: Record<string, unknown>={}){
  return {
    matchedClientId:null,
    source:{invoiceNumber:'10',accessKey:'',emitterCnpj:'11111111000111',recipientName:'Cliente',recipientCnpj:'',recipientStateRegistration:'',recipientAddress:'',recipientCity:'',recipientState:'SP',recipientZip:'',issueDate:'2026-09-01',confidence:0.99,...overrides},
  } as never;
}

describe('métricas do relatório de ingestão',()=>{
  it('preserva clientes realmente não resolvidos e revisa campos obrigatórios ausentes',()=>{
    const report=buildIngestionReport({docs:[doc()],ortReviewDocs:[],savedCount:0,errorCount:0,autoCreatedCount:3,matchedCount:0,reviewThreshold:0.8});
    expect(report.clientsUnresolved).toBe(1);
    expect(report.needsReviewDocs).toBe(1);
    expect(report.reviewItems![0].reasons.join(' ')).toContain('Mapeamento incompleto');
  });

  it('deduplica a mesma identidade e mantém fornecedores homônimos separados',()=>{
    const ort=(cnpj:string,fileName:string)=>({invoiceNumber:'10',accessKey:'',emitterCnpj:cnpj,fileName,recipientName:'Cliente',confidence:0.5,needsReview:true,unknownFields:[]} as never);
    const report=buildIngestionReport({docs:[doc(),doc({emitterCnpj:'22222222000122'})],ortReviewDocs:[ort('11111111000111','a.pdf'),ort('22222222000122','b.pdf')],savedCount:0,errorCount:0,autoCreatedCount:0,matchedCount:0,reviewThreshold:0.8});
    expect(report.reviewItems).toHaveLength(2);
    expect(report.needsReviewDocs).toBe(report.reviewItems!.length);
    expect(report.needsReviewDocs).toBeLessThanOrEqual(report.totalDocs);
  });
});
