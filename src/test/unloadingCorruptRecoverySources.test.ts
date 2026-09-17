// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

const recoveries=[
 ['UnloadingCancellationConfirmation.tsx','unloadingCancellationKey'],
 ['UnloadingCostCorrectionConfirmation.tsx','unloadingCostCorrectionKey'],
 ['UnloadingCostRegularizationConfirmation.tsx','unloadingCostRegularizationKey'],
 ['UnloadingOpenComplementConfirmation.tsx','unloadingOpenComplementKey'],
 ['OpenComplementExtinctionConfirmation.tsx','openComplementExtinctionKey'],
 ['UnloadingOriginCorrectionConfirmation.tsx','unloadingOriginCorrectionKey'],
 ['UnloadingProjectionRepairConfirmation.tsx','unloadingProjectionRepairKey'],
] as const;

it.each(recoveries)('%s exposes scoped discard for an incompatible outbox',(file,key)=>{
 const source=readFileSync(`src/components/financial/${file}`,'utf8');
 expect(source).toContain('Descartar pedido incompatível');
 expect(source).toContain(`localStorage.removeItem(${key}(tenant,actor))`);
 expect(source).toContain('setCorrupt(false)');
});
