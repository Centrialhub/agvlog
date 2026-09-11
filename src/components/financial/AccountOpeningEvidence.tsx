import {cashOpeningEvidenceSchema} from '@/lib/financial/cashOpeningContract';
import {CashCountDetails} from './CashOpeningForm';
export function AccountOpeningEvidence({type,evidence}:{type:string;evidence:unknown}){
 if(type!=='cash_count_v1')return <p>Origem: saldo bancário OFX.</p>;
 const parsed=cashOpeningEvidenceSchema.safeParse(evidence);if(!parsed.success)return <p role="alert">Contagem preservada precisa de revisão.</p>;
 return <details><summary>Contagem física preservada · início de {parsed.data.effective_from}</summary><p>Responsável pela guarda: {parsed.data.custodian_name}</p><p>Fuso: São Paulo · valores de início do dia</p><CashCountDetails counts={parsed.data.counts}/></details>;
}
