export const DRIVER_EMAIL_DOMAIN = 'usuario.com';

export function normalizeDriverUsername(value: string): string {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$/.test(username) || username.includes('..')) {
    throw new Error('Use um usuário de 3 a 40 caracteres, com letras sem acento, números, ponto, hífen ou sublinhado. Comece e termine com letra ou número.');
  }
  return username;
}

export function driverLoginEmail(value: string): string {
  return `${normalizeDriverUsername(value)}@${DRIVER_EMAIL_DOMAIN}`;
}

export function driverUsernameFromEmail(email?: string | null): string | null {
  if (!email?.toLowerCase().endsWith(`@${DRIVER_EMAIL_DOMAIN}`)) return null;
  const username = email.slice(0, -(`@${DRIVER_EMAIL_DOMAIN}`.length));
  try { return normalizeDriverUsername(username); } catch { return null; }
}

export function validateDriverPassword(password: string): void {
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || new TextEncoder().encode(password).length > 72) {
    throw new Error('Use uma senha de 12 ou mais caracteres, com maiúscula, minúscula e número (máximo de 72 bytes).');
  }
}
