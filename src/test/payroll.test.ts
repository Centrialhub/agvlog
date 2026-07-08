import { describe, it, expect } from 'vitest';

// Mirrors recompute_payroll_entry_totals: paid > net produces carryover, never negative to_pay.
function computeTotals(items: { nature: 'credit'|'debit'|'already_paid'|'info'; amount: number }[]) {
  const gross = items.filter(i => i.nature === 'credit').reduce((s,i) => s + i.amount, 0);
  const debit = items.filter(i => i.nature === 'debit').reduce((s,i) => s + i.amount, 0);
  const paid = items.filter(i => i.nature === 'already_paid').reduce((s,i) => s + i.amount, 0);
  const net = gross - debit;
  const to_pay = paid > net ? 0 : net - paid;
  const carry = paid > net ? paid - net : 0;
  return { gross, debit, paid, net, to_pay, carry };
}

describe('payroll totals', () => {
  it('base salary only produces to_pay = salary', () => {
    const r = computeTotals([{ nature: 'credit', amount: 3000 }]);
    expect(r.to_pay).toBe(3000);
    expect(r.carry).toBe(0);
  });

  it('driver settlement + payment already made', () => {
    const r = computeTotals([
      { nature: 'credit', amount: 5000 },
      { nature: 'already_paid', amount: 5000 },
    ]);
    expect(r.to_pay).toBe(0);
    expect(r.carry).toBe(0);
  });

  it('paid > net produces carryover, no negative to_pay', () => {
    const r = computeTotals([
      { nature: 'credit', amount: 1000 },
      { nature: 'already_paid', amount: 1500 },
    ]);
    expect(r.to_pay).toBe(0);
    expect(r.carry).toBe(500);
  });

  it('incident discount reduces net', () => {
    const r = computeTotals([
      { nature: 'credit', amount: 3000 },
      { nature: 'debit', amount: 200 },
    ]);
    expect(r.net).toBe(2800);
    expect(r.to_pay).toBe(2800);
  });

  it('mixed sources', () => {
    const r = computeTotals([
      { nature: 'credit', amount: 3000 },     // base salary
      { nature: 'credit', amount: 500 },      // expense reimb
      { nature: 'debit', amount: 150 },       // incident discount
      { nature: 'already_paid', amount: 800 },// advance paid
      { nature: 'info', amount: 999 },        // ignored
    ]);
    expect(r.gross).toBe(3500);
    expect(r.debit).toBe(150);
    expect(r.paid).toBe(800);
    expect(r.net).toBe(3350);
    expect(r.to_pay).toBe(2550);
  });
});