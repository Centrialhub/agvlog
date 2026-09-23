import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('resolve empates de odômetro pelo maior id, como o trigger do banco', () => {
  const source = readFileSync('src/hooks/useFleetManagement.tsx', 'utf8');
  expect(source).toContain(".order('recorded_at', { ascending: false }).order('id', { ascending: false })");
});
