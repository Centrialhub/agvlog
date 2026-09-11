import {describe,expect,it} from 'vitest';
import {evaluateSsxReadiness} from '@/lib/ssxReadiness';

const now=new Date('2026-09-10T12:00:00Z').getTime();
const healthy={accounts:[{status:'ok'}],health:{first_successful_run_at:'2026-09-09T11:00:00Z',
  last_successful_run_at:'2026-09-10T11:50:00Z',successful_run_count:288},positionStats:{total:10,fresh:8},mappingConflicts:[],now};

describe('SSX readiness evidence',()=>{
  it('requires configured healthy credentials, not an empty account list',()=>{
    expect(evaluateSsxReadiness({...healthy,accounts:[]}).gates.find(g=>g.key==='authentication')?.met).toBe(false);
    expect(evaluateSsxReadiness(healthy).gates.find(g=>g.key==='authentication')?.met).toBe(true);
  });
  it('requires both a 24-hour history and a fresh recent successful run',()=>{
    expect(evaluateSsxReadiness(healthy).gates.find(g=>g.key==='pipeline_24h')?.met).toBe(true);
    expect(evaluateSsxReadiness({...healthy,health:{...healthy.health,first_successful_run_at:'2026-09-10T10:00:00Z'}})
      .gates.find(g=>g.key==='pipeline_24h')?.met).toBe(false);
    expect(evaluateSsxReadiness({...healthy,health:{...healthy.health,last_successful_run_at:'2026-09-10T10:00:00Z'}})
      .gates.find(g=>g.key==='pipeline_24h')?.met).toBe(false);
  });
  it('uses an operational 80% freshness threshold',()=>{
    expect(evaluateSsxReadiness(healthy).gates.find(g=>g.key==='coverage')?.met).toBe(true);
    expect(evaluateSsxReadiness({...healthy,positionStats:{total:10,fresh:7}}).gates.find(g=>g.key==='coverage')?.met).toBe(false);
  });
  it('only reports ready when every evidence gate is met',()=>{
    expect(evaluateSsxReadiness(healthy).allMet).toBe(true);
    expect(evaluateSsxReadiness({...healthy,mappingConflicts:[{unit:'x'}]}).allMet).toBe(false);
  });
});
