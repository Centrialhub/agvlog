import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { FiscalEnvironmentSelect } from '@/components/fiscal/FiscalEnvironmentSelect';

describe('fiscal environment selector', () => {
  it('names the selector, preserves homologation and makes production an explicit choice', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement('div');
    const root = createRoot(container);
    const onChange = vi.fn();
    try {
      await act(async () => root.render(<FiscalEnvironmentSelect value="homologation" onChange={onChange} />));
      const select = container.querySelector('select')!;
      const label = container.querySelector('label')!;
      expect(label.htmlFor).toBe(select.id);
      expect(label.textContent).toBe('Ambiente fiscal');
      expect(select.value).toBe('homologation');
      expect([...select.options].map(option => option.textContent)).toContain('Produção — documento real');
      await act(async () => { select.value = 'production'; select.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(onChange).toHaveBeenCalledWith('production');
      await act(async () => root.render(<FiscalEnvironmentSelect value="production" onChange={onChange} disabled />));
      expect(select).toBeDisabled();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
