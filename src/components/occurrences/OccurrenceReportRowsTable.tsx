import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { resolutionTypeLabels } from '@/lib/occurrenceReports/occurrenceReportBuilder';
import type { OccurrenceRow } from '@/hooks/useOccurrenceReports';

interface OccurrenceReportRowsTableProps {
  rows: OccurrenceRow[];
  emptyLabel: string;
}

export function OccurrenceReportRowsTable({ rows, emptyLabel }: OccurrenceReportRowsTableProps) {
  const navigate = useNavigate();
  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Data</TableHead><TableHead>NF</TableHead><TableHead>Cliente</TableHead>
          <TableHead>Cidade</TableHead><TableHead>Fornecedor</TableHead><TableHead>Tipo</TableHead>
          <TableHead>Resolução</TableHead><TableHead>Motivo</TableHead><TableHead>Folha</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((occurrence) => (
            <TableRow key={occurrence.id}>
              <TableCell>{occurrence.occurrence_date ?? '—'}</TableCell>
              <TableCell>{occurrence.invoice_number ?? '—'}</TableCell>
              <TableCell>{occurrence.customer_name ?? '—'}</TableCell>
              <TableCell>{occurrence.city ?? '—'}</TableCell>
              <TableCell>{occurrence.supplier_name ?? '—'}</TableCell>
              <TableCell>{occurrence.occurrence_type ?? '—'}</TableCell>
              <TableCell>{resolutionTypeLabels[occurrence.resolution_type ?? ''] ?? '—'}</TableCell>
              <TableCell className="max-w-[280px] truncate">{occurrence.occurrence_reason ?? occurrence.resolution_notes ?? '—'}</TableCell>
              <TableCell>
                <Button size="sm" variant="ghost" onClick={() => navigate(`/occurrences/${occurrence.id}/return-sheet`)}>
                  Folha
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">{emptyLabel}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}
