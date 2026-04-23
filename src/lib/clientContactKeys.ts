// Stable identity keys for client contacts/addresses.
// MUST mirror the dedupe logic in supabase/functions/clients-merge-contacts-addresses/index.ts
// so the IDs persisted on the unified ORT match what the backend stores.

export interface ContactSnapshot { phone?: string; name?: string; email?: string }
export interface AddressSnapshot { street?: string; number?: string; neighborhood?: string; city?: string; state?: string; zip?: string }

const onlyDigits = (v: string) => (v || '').replace(/\D/g, '');
const norm = (v: string) => (v || '').trim().toLowerCase();

export function contactKey(c: ContactSnapshot | null | undefined): string {
  if (!c) return '';
  const phone = onlyDigits(c.phone || '');
  if (phone) return `phone:${phone}`;
  const email = norm(c.email || '');
  if (email) return `email:${email}`;
  const name = norm(c.name || '');
  return name ? `name:${name}` : '';
}

export function addressKey(a: AddressSnapshot | null | undefined): string {
  if (!a) return '';
  const zip = onlyDigits(a.zip || '');
  const num = norm(a.number || '');
  if (zip) return `zip:${zip}|num:${num}`;
  const street = norm(a.street || '');
  const city = norm(a.city || '');
  if (street) return `street:${street}|num:${num}|city:${city}`;
  return '';
}