import {it,expect} from 'vitest';
import {movementUseError} from '@/lib/financial/movementUseErrors';
import {financeError} from '@/lib/financial/ledgerContract';
import {financialError} from '@/lib/financial/receivableCommands';
import {settlementPaymentError} from '@/lib/financial/settlementPaymentClient';
it.each(['finance_movement_use_busy','finance_movement_voided','finance_movement_reference_invalid','finance_movement_capacity_inconsistent'])('explains %s consistently across batch, receipts and settlements',code=>{const expected=movementUseError(new Error(code));expect(expected).toBeTruthy();expect(expected).not.toContain('finance_');expect(financeError(new Error(code))).toBe(expected);expect(financialError({message:code})).toBe(expected);expect(settlementPaymentError(new Error(code))).toBe(expected);});
