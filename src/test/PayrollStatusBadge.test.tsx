import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PayrollStatusBadge } from '@/components/financial/PayrollStatusBadge';
import { PAYROLL_PERIOD_STATUS_LABELS } from '@/hooks/usePayroll';

afterEach(cleanup);

describe('PayrollStatusBadge', () => {
  it.each(Object.entries(PAYROLL_PERIOD_STATUS_LABELS))('preserves the label for %s', (status, label) => {
    render(<PayrollStatusBadge status={status} />);
    expect(screen.getByText(label)).toHaveClass('text-[10px]');
  });

  it.each(['unknown_status', 'constructor', '__proto__'])('renders an unknown status as text: %s', status => {
    render(<PayrollStatusBadge status={status} />);
    expect(screen.getByText(status)).toBeVisible();
  });
});
