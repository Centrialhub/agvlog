// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createPortalPrivacyDatabase,portalDetail} from './helpers/portalPrivacyDatabase';
let db:PGlite;beforeAll(async()=>{db=await createPortalPrivacyDatabase();},30000);afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});
describe('local baseline reproduction: shipment detail privacy',()=>{
 it.each(['v1','v2'])('%s exposes private dispatch notes despite an internal occurrence',async(version)=>{
  const result=JSON.stringify(await portalDetail(db,version));expect(result).toContain('QA-NOTA-INTERNA-CONFIDENCIAL');expect(result).toContain('QA-NOTA-INTERNA-NA-CHEGADA');expect(result).not.toContain('QA-OCORRENCIA-INTERNA');
 });
 it.each(['v1','v2'])('%s exposes another client occurrence sharing the stop',async(version)=>{
  const result=JSON.stringify(await portalDetail(db,version));expect(result).toContain('QA-OCORRENCIA-OUTRO-CLIENTE');
 });
 it('lets an unrelated open occurrence change this note public status',async()=>{expect((await portalDetail(db)).document).toMatchObject({public_status:'exception'});});
});
