import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FinanceSection } from '@/components/financial/FinanceSection';

describe('montagem sob demanda das seções financeiras', () => {
  it('não monta o painel fechado e o monta quando a seção é aberta', async () => {
    const mounted = vi.fn();
    function QueryPanel() {
      useEffect(() => { mounted(); }, []);
      return <p>Consulta carregada</p>;
    }

    render(<FinanceSection title="Conferência" description="Dados do período"><QueryPanel /></FinanceSection>);
    expect(screen.queryByText('Consulta carregada')).not.toBeInTheDocument();
    expect(mounted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Conferência').closest('summary')!);

    await waitFor(() => expect(screen.getByText('Consulta carregada')).toBeInTheDocument());
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});
