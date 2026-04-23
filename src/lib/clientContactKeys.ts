// Stable identity keys for client contacts/addresses.
// MUST mirror the dedupe logic in supabase/functions/clients-merge-contacts-addresses/index.ts
// so the IDs persisted on the unified ORT match what the backend stores.

export interface ContactSnapshot { phone?: string; name?: string; email?: string }
export interface AddressSnapshot { street?: string; number?: string; neighborhood?: string; city?: string; state?: string; zip?: string }

export type ContactMatchRule = 'exact' | 'phone-tail' | 'email-local' | 'name-token';
export type AddressMatchRule = 'exact' | 'zip' | 'street-city';
export interface MatchResult<T, R> { value: T; rule: R }

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

/**
 * Best-effort lookup of a contact in a client's contact list by stable refKey.
 * Strategy:
 *  1) Exact key match (e.g. phone digits or normalized email/name).
 *  2) Partial fallback (e.g. last 8 digits of phone, fuzzy email/name prefix).
 * Returns the matched contact or null. The caller is responsible for keeping
 * the original refKey for audit traceability when reapplying.
 */
export function findContactByKey(
  contacts: ContactSnapshot[] | null | undefined,
  key: string | null | undefined,
): MatchResult<ContactSnapshot, ContactMatchRule> | null {
  if (!contacts || !key) return null;
  // Exact match first
  const exact = contacts.find(c => contactKey(c) === key);
  if (exact) return { value: exact, rule: 'exact' };
  // Partial: phone with same last 8 digits
  if (key.startsWith('phone:')) {
    const target = key.slice('phone:'.length);
    const tail = target.slice(-8);
    if (tail.length >= 8) {
      const m = contacts.find(c => onlyDigits(c.phone || '').endsWith(tail));
      if (m) return { value: m, rule: 'phone-tail' };
    }
  }
  // Partial: email local-part match
  if (key.startsWith('email:')) {
    const target = key.slice('email:'.length);
    const local = target.split('@')[0];
    if (local) {
      const m = contacts.find(c => norm(c.email || '').startsWith(local + '@'));
      if (m) return { value: m, rule: 'email-local' };
    }
  }
  // Partial: name token overlap
  if (key.startsWith('name:')) {
    const target = key.slice('name:'.length);
    const m = contacts.find(c => {
      const n = norm(c.name || '');
      return !!n && (n.includes(target) || target.includes(n));
    });
    if (m) return { value: m, rule: 'name-token' };
  }
  return null;
}

/**
 * Best-effort lookup of an address in a client's address list by stable refKey.
 * Falls back to street+city or zip-only matches when the full key drifts.
 */
export function findAddressByKey(
  addresses: AddressSnapshot[] | null | undefined,
  key: string | null | undefined,
): MatchResult<AddressSnapshot, AddressMatchRule> | null {
  if (!addresses || !key) return null;
  const exact = addresses.find(a => addressKey(a) === key);
  if (exact) return { value: exact, rule: 'exact' };
  // Partial: same zip, any number
  if (key.startsWith('zip:')) {
    const rest = key.slice('zip:'.length);
    const zip = rest.split('|')[0];
    if (zip) {
      const m = addresses.find(a => onlyDigits(a.zip || '') === zip);
      if (m) return { value: m, rule: 'zip' };
    }
  }
  // Partial: same street + city, ignore number
  if (key.startsWith('street:')) {
    const rest = key.slice('street:'.length);
    const [street, _num, cityPart] = rest.split('|');
    const city = cityPart?.replace(/^city:/, '') || '';
    const m = addresses.find(a => {
      const s = norm(a.street || '');
      const c = norm(a.city || '');
      return !!s && (s === street) && (!city || c === city);
    });
    if (m) return { value: m, rule: 'street-city' };
  }
  return null;
}

/**
 * Diff helper: returns the list of field names whose values differ between
 * the snapshot stored in appliedHistory and the live record found via
 * findContactByKey/findAddressByKey. Empty array means no real divergence.
 */
export function diffFields<T extends Record<string, any>>(
  snapshot: T | null | undefined,
  live: T | null | undefined,
  fields: (keyof T)[],
): string[] {
  if (!snapshot || !live) return [];
  const out: string[] = [];
  for (const f of fields) {
    const a = (snapshot[f] ?? '').toString().trim();
    const b = (live[f] ?? '').toString().trim();
    if (a !== b) out.push(String(f));
  }
  return out;
}