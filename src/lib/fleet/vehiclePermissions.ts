export function canAdministerVehicle(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}
