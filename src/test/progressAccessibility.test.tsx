import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Progress } from '@/components/ui/progress';

describe('Progress accessibility', () => {
  it('exposes its value and accessible description', () => {
    render(<Progress aria-label="Processamento" aria-valuetext="Metade concluída" value={50} />);
    const progress = screen.getByRole('progressbar', { name: 'Processamento' });
    expect(progress).toHaveAttribute('aria-valuenow', '50');
    expect(progress).toHaveAttribute('aria-valuetext', 'Metade concluída');
  });

  it('normalizes invalid and out-of-range values', () => {
    const { rerender } = render(<Progress aria-label="Progresso inválido" value={Number.NaN} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    rerender(<Progress aria-label="Progresso máximo" value={150} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});
