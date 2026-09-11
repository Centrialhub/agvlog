import {readFileSync} from 'node:fs';
import {createMovementCorrectionContextDatabase} from './movementCorrectionContextDatabase';
export async function createPublicManualMovementVoidDatabase(){const db=await createMovementCorrectionContextDatabase();for(const file of ['20260910190635_finance_movement_correction_preview.sql','20260910191905_finance_manual_movement_void_command.sql','20260910192831_finance_manual_movement_void_public_dispatch.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));return db;}
