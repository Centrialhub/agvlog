import { shiftDateInputValue } from '@/lib/utils/formatDate';

export type MaintenanceSchedule = {
  scheduled_date?: string | null;
  next_date?: string | null;
};

export function maintenanceAlertDate(maintenance: MaintenanceSchedule): string | null {
  return maintenance.scheduled_date || maintenance.next_date || null;
}

export function maintenanceAlertHorizon(today: string): string {
  return shiftDateInputValue(today, 7);
}

export function maintenanceFormError(input: {
  description: string;
  scheduledDate: string;
  nextDate: string;
  nextOdometer: string;
}): string | null {
  if (!input.description.trim()) return 'Informe a descrição da manutenção.';
  const odometer = Number(input.nextOdometer);
  if (!input.scheduledDate && !input.nextDate && (!input.nextOdometer || !Number.isFinite(odometer) || odometer <= 0)) {
    return 'Informe uma data agendada, próxima data ou próxima quilometragem.';
  }
  return null;
}
