import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('inventory historical movement filter',()=>{
 it('offers transfer in history while excluding it from the creation form',()=>{
  const page=readFileSync('src/pages/Inventory.tsx','utf8');
  expect(page).toContain('...ALL_MOVEMENT_TYPES.map');
  expect(page).toContain('{MOVEMENT_TYPES.map');
 });
});
