import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('paginação estável da aprovação de despesas', () => {
  it('usa cursor composto no banco, hook e tela', () => {
    const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260921140000_keyset_expense_review_list.sql'), 'utf8');
    const hook = readFileSync(join(process.cwd(), 'src/hooks/useExpenseReview.ts'), 'utf8');
    const page = readFileSync(join(process.cwd(), 'src/pages/ExpenseApproval.tsx'), 'utf8');

    expect(migration).toContain('(expense.expense_at,expense.id)<(_cursor_expense_at,_cursor_id)');
    expect(migration).toContain('order by expense.expense_at desc,expense.id desc');
    expect(migration).not.toContain('offset _offset');
    expect(hook).toContain("'list_driver_expenses_for_review_v2'");
    expect(page).toContain('setCursors(value=>[...value,page.next_cursor])');
  });
});
