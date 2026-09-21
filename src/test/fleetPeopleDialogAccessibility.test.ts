import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dialogSources = [
  {
    path: 'src/pages/Vehicles.tsx',
    description: 'Cadastre os dados de identificação, operação e rastreamento do novo veículo.',
  },
  {
    path: 'src/pages/Drivers.tsx',
    description: 'Cadastre os dados pessoais, documentos e vínculos operacionais do novo motorista.',
  },
  {
    path: 'src/pages/Employees.tsx',
    description: 'Cadastre os dados cadastrais, documentos e observações do novo funcionário.',
  },
];

describe('fleet and people dialog accessibility', () => {
  it.each(dialogSources)('describes the form in $path', ({ path, description }) => {
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('DialogDescription');
    expect(source).toContain(description);
  });
});
