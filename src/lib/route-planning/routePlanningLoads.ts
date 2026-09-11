const recipientCollator = new Intl.Collator('pt-BR', {
  sensitivity: 'base',
  numeric: true,
});

export interface RoutePlanningLoadItem {
  id: string;
  load_id: string;
  item_description: string;
  pallet_count: number;
  weight_kg: number;
  volume_m3: number;
  fiscal_document_id: string | null;
  fiscal_documents?: {
    invoice_number: string | null;
    remitter: string | null;
    recipient: string | null;
    recipient_city: string | null;
    recipient_state: string | null;
    recipient_neighborhood: string | null;
    client_id?: string | null;
    supplier_id?: string | null;
    client_address?: string | null;
    value: number | null;
    weight_kg: number | null;
    issue_date: string | null;
  } | null;
}

export interface PendingRoutePlanningLoad {
  id: string;
  load_number: string;
  destination: string | null;
  total_weight_kg: number | null;
  total_volume_m3: number | null;
  total_pallet_count: number | null;
  status: string;
  created_at: string;
  notes: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  items: RoutePlanningLoadItem[];
}

const getLoadRecipient = (load: PendingRoutePlanningLoad) =>
  load.items[0]?.fiscal_documents?.recipient ||
  load.destination ||
  load.load_number ||
  '';

export const sortLoadsByRecipient = (loads: PendingRoutePlanningLoad[]) =>
  [...loads].sort(
    (a, b) =>
      recipientCollator.compare(getLoadRecipient(a), getLoadRecipient(b)) ||
      recipientCollator.compare(a.load_number, b.load_number),
  );

export const sortAvailableLoadsByRecipient = (loads: PendingRoutePlanningLoad[]) =>
  [...loads].sort((a, b) => {
    const recipientA = a.items[0]?.fiscal_documents?.recipient || a.destination || '';
    const recipientB = b.items[0]?.fiscal_documents?.recipient || b.destination || '';
    return (
      recipientCollator.compare(recipientA, recipientB) ||
      recipientCollator.compare(a.load_number, b.load_number)
    );
  });

export const sortItemsByRecipient = (items: RoutePlanningLoadItem[]) =>
  [...items].sort(
    (a, b) =>
      recipientCollator.compare(
        a.fiscal_documents?.recipient || '—',
        b.fiscal_documents?.recipient || '—',
      ) ||
      recipientCollator.compare(
        a.fiscal_documents?.invoice_number || '—',
        b.fiscal_documents?.invoice_number || '—',
      ),
  );
