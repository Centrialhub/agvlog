export function maintenanceOrderRequiredFieldsError(
  vehicleId: string,
  reportedProblem: string,
): string | null {
  if (!vehicleId.trim()) return 'Selecione o veículo da ordem de manutenção.';
  if (!reportedProblem.trim()) return 'Informe o problema relatado.';
  return null;
}
