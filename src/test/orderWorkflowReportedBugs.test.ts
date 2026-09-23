import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page=readFileSync('src/pages/Orders.tsx','utf8');
const normalization=readFileSync('src/lib/orders/orderFormNormalization.ts','utf8');
const hook=readFileSync('src/hooks/useOrders.tsx','utf8');
const navigation=readFileSync('src/components/layout/navigation.ts','utf8');
const routes=readFileSync('src/app/AppRoutes.tsx','utf8');
const migration=readFileSync('supabase/migrations/20260922006000_harden_order_workflow.sql','utf8');

describe('hardened order workflow',()=>{
  it('normalizes nullable dates and permits clearing the optional client',()=>{
    expect(normalization).toContain("'issue_date'");
    expect(normalization).toContain("'promised_date'");
    expect(page).toContain('normalizeOrderOptionalFields(out)');
    expect(page).toContain('<SelectItem value={NO_CLIENT}>Nenhum</SelectItem>');
    expect(page).toContain("v === NO_CLIENT ? '' : v");
  });

  it('preserves an explicit zero pallet count',()=>{
    expect(page).toContain("pallet_count: order?.pallet_count ?? ''");
    expect(page).toContain("String(out[k] ?? '').trim() === '' ? null : Number(out[k])");
    expect(page).not.toContain('parseInt(e.target.value) || 0');
  });

  it('aligns order write affordances with the admin-only database policy',()=>{
    expect(navigation).toContain("href: '/orders', icon: ShoppingCart, roles: ['owner', 'admin']");
    expect(routes).toContain("roles={['owner', 'admin']}");
    expect(page).toContain("const canManage = currentRole === 'owner' || currentRole === 'admin'");
    expect(hook).toContain('Somente administradores podem criar pedidos.');
    expect(hook).toContain('Somente administradores podem alterar pedidos.');
  });

  it('rejects unknown statuses and records complete before/after versions',()=>{
    expect(migration).toContain('constraint orders_status_check');
    expect(migration).toContain('order_versions');
    expect(migration).toContain('to_jsonb(old),to_jsonb(new)');
    expect(migration).toContain("'order_update'");
  });
});
