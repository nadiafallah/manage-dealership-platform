// Server-side masking for guest sessions (reconstruction scenario, owner 2026-11-25): a guest is
// read only, and the customer's mobile, the owner's full name, the full chassis/VIN and amounts
// are hidden. The API applies this to every JSON answer of a guest-only session, so a screen added
// later cannot leak them by forgetting a check. Plates and part names stay visible.

const NAME_KEYS = new Set(['customername', 'ownername', 'fullname', 'deliverername', 'recipientname']);
const ID_KEYS = new Set(['vin', 'chassis', 'chassisno', 'vinkey']);
/** Objects whose plain `name` is a person: `{ customer: { name } }`. */
const PERSON_PARENTS = new Set(['customer', 'owner', 'deliverer']);
const HIDDEN_KEYS = new Set(['phone', 'mobile', 'customerphone', 'customermobile', 'deliverermobile', 'nationalid', 'customernationalid', 'address', 'customeraddress']);

/** «علی هدایت» → «ع… ه…». */
export function maskPersonName(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).map((w) => `${[...w][0]}…`).join(' ');
}

/** Only the last four characters: «•••••••••••••1234». */
export function maskVehicleId(value: string): string {
  const v = value.trim();
  return v.length <= 4 ? '••••' : `${'•'.repeat(Math.min(v.length - 4, 13))}${v.slice(-4)}`;
}

/** Rial amounts by naming convention (…Rial), and the few plain amount fields; counts such as `total` stay. */
const isAmountKey = (key: string) => /rial$/i.test(key) || /^(amount|price|unitprice|cost)$/i.test(key);

/** A deep copy of a JSON-like answer with guest-hidden fields masked. Dates and non-plain objects are kept. */
export function maskForGuest<T>(value: T): T {
  return walk(value, '', '') as T;
}

function walk(value: unknown, key: string, parent: string): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, key, parent));
  if (value && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v, k, key);
    return out;
  }
  const k = key.toLowerCase();
  if (typeof value === 'string' && value) {
    if (NAME_KEYS.has(k) || (k === 'name' && PERSON_PARENTS.has(parent.toLowerCase()))) return maskPersonName(value);
    if (ID_KEYS.has(k)) return maskVehicleId(value);
    if (HIDDEN_KEYS.has(k)) return null;
  }
  if (typeof value === 'number' && isAmountKey(key)) return null;
  return value;
}
