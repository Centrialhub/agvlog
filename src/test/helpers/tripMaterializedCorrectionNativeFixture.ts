import {createTripMaterializedCorrectionDatabase} from './tripMaterializedCorrectionDatabase';

export async function prepareTripMaterializedCorrectionNativeFixture(){
 const db=await createTripMaterializedCorrectionDatabase();
 await db.exec('reset role');
}
