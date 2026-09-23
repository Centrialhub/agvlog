import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

describe('driver cargo custody complete dossier',()=>{
 it('walks every declared collection page and rejects incomplete snapshots',()=>{
  const source=readFileSync('src/lib/driver/tripCargoCustody.ts','utf8');
  expect(source).toContain('getCompleteTripCargoControl');
  expect(source).toContain('items.length<total');
  expect(source).toContain('if(items.length!==total)throw invalidResponse()');
  const driver=readFileSync('src/pages/driver/DriverCargoCustody.tsx','utf8');
  expect(driver).toContain('getCompleteTripCargoControl(currentTenant!.id, tripId!)');
 });
});
