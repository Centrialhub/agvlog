import {receivableAdjustmentLabel} from '@/lib/financial/receivableAdjustmentLabels';
import {expect,it} from 'vitest';
import {receivablePortfolioSchema} from '@/lib/financial/receivablePortfolioContract';
import {financeAuditActions} from '@/lib/financial/financeAuditContract';
const amounts={nominal_cents:'10000000000000001',received_allocated_cents:'10000000000000000',open_cents:'1',cash_received_cents:'9000000000000000',credit_applied_cents:'0',discount_cents:'500000000000000',loss_cents:'500000000000000',adjustment_cents:'1000000000000000',settled_cents:'10000000000000000'};
const row={version:1,tenant_id:crypto.randomUUID(),from:null,to:null,client_id:null,as_of:'2026-09-11',total_titles:1501,canceled_titles:0,invalid_titles:0,totals_valid:true,...amounts,overdue_cents:'1',status_rows:[{status:'partial',count:1501,...amounts}]};
it('preserves separate discount/loss totals beyond Number precision and rejects incomplete or divergent categories',()=>{expect(receivablePortfolioSchema.safeParse(row).success).toBe(true);for(const change of [{discount_cents:undefined},{discount_cents:null},{discount_cents:'500000000000001'},{status_rows:[{...row.status_rows[0],discount_cents:'0',loss_cents:'1000000000000000'}]}])expect(receivablePortfolioSchema.safeParse({...row,...change}).success).toBe(false);});
it('labels actual audit actions separately without confusing entity type with action',()=>{expect(financeAuditActions.receivable_discount_applied).toMatch(/Desconto concedido/);expect(financeAuditActions.receivable_loss_applied).toMatch(/Perda registrada/);expect(financeAuditActions.receivable_balance_adjustment_reversed).toMatch(/revertida/);});

it('explains source date proof separately from a date preceding that source',()=>{expect(receivableAdjustmentLabel('finance_adjustment_date_before_source')).toContain('data comprovada da origem');expect(receivableAdjustmentLabel('finance_adjustment_date_unproven')).toContain('não foi comprovada');});
