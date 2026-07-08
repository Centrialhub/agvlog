import * as XLSX from 'xlsx';
import type { PalletProtocol } from '@/hooks/usePalletReturns';

export function protocolsToExcel(protocols: PalletProtocol[], filename = 'devolucoes-paletes.xlsx') {
  const rows = protocols.map((p) => ({
    Protocolo: p.protocol_number,
    'Data Lançamento': p.issue_date,
    'Data Devolução': p.returned_at,
    Fornecedor: p.supplier_name_snapshot,
    Status: p.status,
    'Total Paletes': p.total_quantity,
    Tipos: (p.items || []).map((i) => `${i.pallet_type_code}:${i.quantity}`).join(' '),
    Motorista: p.driver_name_snapshot,
    Placa: p.vehicle_plate_snapshot,
    Recebedor: p.receiver_name,
    'Confirmado em': p.confirmed_at,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Protocolos');
  XLSX.writeFile(wb, filename);
}