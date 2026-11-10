export interface OcrAdapterAvailability{available:false;errorCode:'ocr_not_configured'|'ocr_adapter_unsupported'}

// No network-backed adapter is enabled by this foundation. Keeping resolution
// explicit prevents a future environment variable from silently exporting PII.
export function resolveDeliveryReceiptOcrAdapter(value:string|undefined):OcrAdapterAvailability{
  return !value||value.trim()===''||value==='disabled'?{available:false,errorCode:'ocr_not_configured'}:
    {available:false,errorCode:'ocr_adapter_unsupported'};
}
