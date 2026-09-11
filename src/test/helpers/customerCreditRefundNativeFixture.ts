import {createCustomerCreditRefundPublicDatabase} from './customerCreditRefundPublicDatabase';
import {seedCustomerCreditRefundSource} from './customerCreditRefundDatabase';
export async function prepareCustomerCreditRefundNative(){const db=await createCustomerCreditRefundPublicDatabase();const source=await seedCustomerCreditRefundSource(db);await db.exec('commit');return{...source,db};}
