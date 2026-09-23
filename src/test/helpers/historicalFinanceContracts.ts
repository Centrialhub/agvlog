import { financeAuditSchema } from '@/lib/financial/financeAuditContract';
import { settlementExpenseContextSchema } from '@/lib/financial/settlementExpenseContextContract';

// Historical migration fixtures predate these later pagination/revision fields.
// Keep all other current response checks active in the focused predecessor tests.
export const historicalFinanceAuditSchema = financeAuditSchema.partial({ snapshot_at: true });
export const historicalSettlementExpenseContextSchema = settlementExpenseContextSchema.partial({ revision: true });
