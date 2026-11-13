import {checklistItems} from './driverChecklist';
export const VEHICLE_READINESS_MODEL='vehicle_readiness_v1';
export const VEHICLE_READINESS_QUESTIONS=[
 'Verificou a água do veículo?',
 'Verificou o nível de óleo do veículo?',
 'Luzes, faróis e lanternas estão funcionando?',
 'O combustível está suficiente?',
 'Verificou os pneus?',
 'Pode dar partida?',
];
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function vehicleReadinessAnswers(payload:unknown):boolean[]|null{
 if(!record(payload)||payload.schema_version!==2||payload.checklist_model!==VEHICLE_READINESS_MODEL
  ||payload.total_items!==6||!Array.isArray(payload.answers)||payload.answers.length!==6
  ||payload.answers.some(answer=>typeof answer!=='boolean'))return null;
 const checked=checklistItems(payload,6);
 return checked.length===6?payload.answers as boolean[]:null;
}
export function preChecklistProgress(payload:unknown){
 const answers=vehicleReadinessAnswers(payload);
 if(answers)return {complete:true,items:[0,1,2,3,4,5],total:6,answers};
 // Legacy records remain valid under their own eight-item contract.
 const legacy=record(payload)&&!('checklist_model' in payload)&&(!('schema_version' in payload)||payload.schema_version===1);
 const items=legacy?checklistItems(payload,8):[];
 return {complete:items.length===8,items,total:legacy?8:6,answers:null};
}
