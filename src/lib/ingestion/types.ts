export interface OrtReviewItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  weightKg?: number;
  volumeM3?: number;
  confidence?: number;
}

export interface OrtAuditEntry {
  field: string;
  fieldLabel: string;
  previousValue: string;
  newValue: string;
  changedAt: string;
  changedBy: string;
}

export interface OrtApplyHistoryEntry {
  type: 'contact' | 'address';
  appliedAt: string;
  label: string;
  previousValues: Record<string, string>;
  newValues: Record<string, string>;
  refKey?: string;
  matchRule?: 'exact' | 'phone-tail' | 'email-local' | 'name-token' | 'zip' | 'street-city' | 'snapshot';
  changedFields?: string[];
}

export interface OrtReviewDocument {
  documentKind: 'nfe' | 'ort';
  accessKey?: string;
  invoiceNumber: string;
  issueDate: string;
  paymentTerms: string;
  billing: string;
  cargoDescription: string;
  emitterName: string;
  emitterCnpj: string;
  recipientName: string;
  recipientCnpj: string;
  recipientPhone: string;
  recipientCity: string;
  recipientState: string;
  recipientAddress: string;
  recipientAddressNumber: string;
  recipientZip: string;
  recipientNeighborhood: string;
  recipientFantasyName?: string;
  recipientStateRegistration?: string;
  recipientMunicipalRegistration?: string;
  recipientIeIndicator?: string;
  recipientEmail?: string;
  recipientAddressComplement?: string;
  recipientCountry?: string;
  recipientCountryCode?: string;
  recipientCityCode?: string;
  totalValue: number;
  totalWeight: number;
  totalVolume: number;
  estimatedPallets: number;
  productSummary: string;
  items?: OrtReviewItem[];
  confidence: number;
  needsReview: boolean;
  fieldConfidences?: Record<string, number>;
  fileName: string;
  sourcePages?: string[];
  pageCount?: number;
  extractedPayload?: Record<string, unknown>;
  unifiedDocId?: string;
  mergedFrom?: number;
  unknownFields?: string[];
  auditLog?: OrtAuditEntry[];
  appliedHistory?: OrtApplyHistoryEntry[];
  linkedClientId?: string | null;
  linkedContactKey?: string | null;
  linkedAddressKey?: string | null;
  linkedAt?: string | null;
}

export interface ReviewItem {
  invoiceNumber: string;
  fileName?: string;
  recipientName?: string;
  confidence?: number;
  reasons: string[];
}

export interface IngestionReport {
  totalDocs: number;
  savedDocs: number;
  errorDocs: number;
  needsReviewDocs: number;
  clientsAutoCreated: number;
  clientsMatched: number;
  clientsUnresolved: number;
  fieldCoverage: {
    label: string;
    key: string;
    filled: number;
    total: number;
  }[];
  reviewItems?: ReviewItem[];
  reviewThreshold?: number;
  auditMeta?: {
    tenantId?: string | null;
    tenantName?: string | null;
    batchId?: string | null;
    sourceLabel?: string | null;
    generatedAt?: string | null;
    periodFrom?: string | null;
    periodTo?: string | null;
    generatedByUserId?: string | null;
  };
}
