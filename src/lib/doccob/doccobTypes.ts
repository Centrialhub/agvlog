export type DoccobRecordType = '000' | '350' | '351' | '352' | '353' | '354' | '355';

export const DOCCOB_LINE_LENGTHS: Record<DoccobRecordType, number> = {
  '000': 120,
  '350': 60,
  '351': 120,
  '352': 180,
  '353': 200,
  '354': 180,
  '355': 60,
};

export interface DoccobCarrier {
  cnpj: string;
  name: string;
  companyCode?: string;
  branchCode?: string;
}

export interface DoccobProfileSnapshot {
  destinationName?: string;
  companyCode?: string;
  branchCode?: string;
  documentType?: string;
  bankName?: string | null;
  bankAgency?: string | null;
  bankAccount?: string | null;
  layoutVersion?: string;
  allowChargeWithoutDetails?: boolean;
}

export interface DoccobChargeInput {
  id: string;
  sourceType: string;
  sourceNumber?: string | null;
  sourceSeries?: string | null;
  referenceNumber?: string | null;
  issueDate?: string | null;
  grossAmount: number;
  description?: string | null;
  carrierCnpj?: string | null;
  details: DoccobDetailInput[];
}

export interface DoccobDetailInput {
  id: string;
  documentNumber?: string | null;
  emissionDate?: string | null;
  cargoValue?: number | null;
  weightKg?: number | null;
  chargeId: string;
}

export interface DoccobInvoiceInput {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  totalAmount: number;
  clientName: string;
  clientTaxId?: string | null;
  paymentMethod?: string | null;
  charges: DoccobChargeInput[];
}

export interface DoccobBuildInput {
  carrier: DoccobCarrier;
  profile: DoccobProfileSnapshot;
  invoices: DoccobInvoiceInput[];
  generatedAt?: Date;
}

export interface DoccobBuildResult {
  content: string;
  recordCount: number;
  invoiceCount: number;
  chargeCount: number;
  detailCount: number;
  totalAmount: number;
  hash: string;
  lengthWarnings: string[];
}

export interface DoccobParsedFile {
  header: Record<string, string> | null;
  identification: Record<string, string> | null;
  carrier: Record<string, string> | null;
  invoices: DoccobParsedInvoice[];
  trailer: Record<string, string> | null;
  validationWarnings: string[];
}

export interface DoccobParsedInvoice {
  raw: string;
  invoiceNumber: string;
  totalCents: number;
  charges: { raw: string; details: string[] }[];
}