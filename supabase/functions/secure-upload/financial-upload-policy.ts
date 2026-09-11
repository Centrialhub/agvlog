const financialRoots=new Set(['finance-batches','expense-receipts','payable-payments','receivable-payments','payables']);
export function isFinancialReceiptFolder(bucket:string,folder:string){return bucket==='receipts'&&financialRoots.has(folder.split('/')[0]);}
export async function financialReceiptProbe<T>(authorized:()=>Promise<boolean>,inspect:()=>PromiseLike<T>):Promise<T|{data:null;error:{message:string}}>{
  if(!await authorized())return {data:null,error:{message:'finance_access_denied'}};return inspect();
}
