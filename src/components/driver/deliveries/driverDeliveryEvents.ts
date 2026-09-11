import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle,
  FileText,
  MapPinned,
  Package,
  PackageX,
  Percent,
  UserX,
} from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

export type EventCategory = 'finalizador' | 'informativo';

export type EventDef = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  category: EventCategory;
  finalAction?: 'delivered' | 'partial' | 'refused';
  requiresReceiver?: boolean;
  requiresPhoto?: boolean;
  requiresReceipt?: boolean;
  requiresSignature?: boolean;
  showsItems?: boolean;
  showsDiscount?: boolean;
  showsContact?: boolean;
  needsOperatorReply?: boolean;
};

export const DRIVER_DELIVERY_EVENTS: EventDef[] = [
  { key: 'entregue', label: 'ENTREGUE', icon: CheckCircle, category: 'finalizador', finalAction: 'delivered', requiresReceiver: true, requiresReceipt: true, requiresSignature: true },
  { key: 'devolucao_parcial', label: 'DEVOLUÇÃO PARCIAL', icon: PackageX, category: 'finalizador', finalAction: 'partial', requiresReceiver: true, requiresReceipt: true, requiresSignature: true, showsItems: true, needsOperatorReply: true },
  { key: 'devolucao_total', label: 'DEVOLUÇÃO TOTAL', icon: Ban, category: 'finalizador', finalAction: 'refused', requiresPhoto: true, showsItems: true, needsOperatorReply: true },
  { key: 'chegada_no_cliente', label: 'CHEGADA NO CLIENTE', icon: MapPinned, category: 'informativo' },
  { key: 'solicitar_desconto', label: 'SOLICITAR DESCONTO', icon: Percent, category: 'informativo', showsDiscount: true, showsContact: true, needsOperatorReply: true },
  { key: 'atualizar_boleto', label: 'ATUALIZAR BOLETO', icon: FileText, category: 'informativo', showsContact: true, needsOperatorReply: true },
  { key: 'avaria', label: 'AVARIA', icon: AlertCircle, category: 'informativo', requiresPhoto: true, showsItems: true },
  { key: 'cliente_recusou', label: 'CLIENTE RECUSOU', icon: PackageX, category: 'informativo', requiresPhoto: true, showsItems: true },
  { key: 'coleta_realizada', label: 'COLETA REALIZADA', icon: Package, category: 'informativo', requiresPhoto: true },
  { key: 'cliente_estava_fora', label: 'CLIENTE ESTAVA FORA', icon: UserX, category: 'informativo' },
  { key: 'outros', label: 'OUTROS', icon: AlertTriangle, category: 'informativo' },
];

export function getDriverDeliveryEvent(key: string): EventDef | undefined {
  return DRIVER_DELIVERY_EVENTS.find((event) => event.key === key);
}

export type DriverStopClient = Pick<Tables<'clients'>, 'company_name' | 'phone' | 'mobile' | 'email'>;

export type DriverStopDocument = {
  fiscal_documents: Pick<Tables<'fiscal_documents'>, 'invoice_number' | 'reference_number'> | null;
};

export type DriverStop = Tables<'dispatch_stops'> & {
  clients: DriverStopClient | null;
  dispatch_stop_documents: DriverStopDocument[];
};

export type StopProduct = {
  id: string;
  fiscalDocumentId?: string;
  attemptId?: string | null;
  isHistorical?: boolean;
  sku: string;
  name: string;
  qty: number;
  unit: string;
  price: number;
  documentStatus: string | null;
};

export type DeliveryEventSelection = { stop: DriverStop; eventKey: string };

export function getStopOrderNumber(stop: DriverStop): string | null {
  const fiscalDocument = stop.dispatch_stop_documents
    ?.map((link) => link.fiscal_documents)
    .find(Boolean);
  const candidates = [fiscalDocument?.invoice_number, fiscalDocument?.reference_number];
  for (const candidate of candidates) {
    if (candidate) return String(candidate);
  }
  if (stop.notes) {
    const match = String(stop.notes).match(/\d{4,}/);
    if (match) return match[0];
  }
  return null;
}
