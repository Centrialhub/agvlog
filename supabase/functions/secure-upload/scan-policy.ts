// Explicitly approved PATCH2 policy. Format validation is not an antivirus verdict.
export const UNSCANNED_UPLOAD_PROVENANCE = Object.freeze({scanned:false,scan_status:'not_performed',scan_policy:'patch2-no-scanner-v1'} as const);
export function hasReceiptScanProvenance(metadata:Record<string,unknown>):boolean {
  // Preserve historical positive provenance without manufacturing it for new files.
  return (metadata.scanned===true && metadata.scan_status===undefined && metadata.scan_policy===undefined)
    || (metadata.scanned===false && metadata.scan_status==='not_performed' && metadata.scan_policy==='patch2-no-scanner-v1');
}
