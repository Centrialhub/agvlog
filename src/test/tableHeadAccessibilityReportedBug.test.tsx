import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';

describe('cabeçalho ordenável acessível', () => {
  it('expõe o estado e permite ordenar com teclado', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead sortKey="name" sortConfig={{ key: 'name', direction: 'asc' }} onSort={onSort}>Nome</TableHead>
            <TableHead>Descrição</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );

    expect(screen.getByRole('columnheader', { name: 'Nome' })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: 'Descrição' })).not.toHaveAttribute('aria-sort');

    await user.tab();
    expect(screen.getByRole('button', { name: 'Nome' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onSort).toHaveBeenNthCalledWith(1, 'name');
    expect(onSort).toHaveBeenNthCalledWith(2, 'name');
  });

  it('anuncia colunas ordenáveis ainda sem ordenação', () => {
    render(<table><thead><tr><TableHead sortKey="name" sortConfig={null} onSort={() => undefined}>Nome</TableHead></tr></thead></table>);
    expect(screen.getByRole('columnheader', { name: 'Nome' })).toHaveAttribute('aria-sort', 'none');
  });
});
