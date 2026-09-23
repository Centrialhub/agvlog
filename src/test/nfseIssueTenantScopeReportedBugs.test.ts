import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook=readFileSync('src/hooks/useNFSe.tsx','utf8');

describe('escopo ativo na emissão de NFS-e',()=>{
  it('restringe documento e emitente ao tenant atual na emissão individual e em lote',()=>{
    const individual=hook.slice(hook.indexOf('export function useIssueNFSe()'),hook.indexOf('export interface IssueNFSeBatchInput'));
    const batch=hook.slice(hook.indexOf('export function useIssueNFSeBatch()'),hook.indexOf('export function useCancelNFSe()'));
    expect(individual).toContain('const { currentTenant } = useTenant()');
    expect(batch).toContain('const { currentTenant } = useTenant()');
    expect(individual.match(/\.eq\('tenant_id', currentTenant\.id\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(batch.match(/\.eq\('tenant_id', currentTenant\.id\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('preserva o erro real da consulta do emitente individual',()=>{
    expect(hook).toContain('const { data: em, error: emitterError }');
    expect(hook).toContain('if (emitterError) throw emitterError');
  });
});
