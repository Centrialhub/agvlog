import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

describe('Table accessibility', () => {
  it('creates a named keyboard-focusable scroll region only when requested', () => {
    const { rerender } = render(
      <Table scrollLabel="Resultados financeiros">
        <TableBody><TableRow><TableCell>Item</TableCell></TableRow></TableBody>
      </Table>,
    );

    expect(screen.getByRole('region', { name: 'Resultados financeiros' })).toHaveAttribute('tabindex', '0');

    rerender(
      <Table>
        <TableBody><TableRow><TableCell>Item</TableCell></TableRow></TableBody>
      </Table>,
    );

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});
