// Storage representation only. Never send this envelope to a creation RPC.
// Every JSON value is preserved; long repeated strings are stored once. Keep
// the v1 key so an older reader blocks a v2 pending command rather than issuing
// a new request. New readers continue to accept ordinary v1 records.
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type EncodedValue = null | boolean | number | string
  | { ref: number } | { array: EncodedValue[] } | { object: [string, EncodedValue][] };
const codec = 'load-creation-string-table';
const invalid = () => new Error('Não foi possível ler a criação pendente. Preserve esta sessão e consulte a carga antes de reenviar.');

export function serializeLoadCreation(row: unknown): string {
  const legacy = JSON.stringify(row);
  const plain = JSON.parse(legacy) as JsonValue;
  const counts = new Map<string, number>();
  const count = (value: JsonValue): void => {
    if (typeof value === 'string' && value.length >= 128) counts.set(value, (counts.get(value) ?? 0) + 1);
    else if (Array.isArray(value)) value.forEach(count);
    else if (value && typeof value === 'object') Object.values(value).forEach(count);
  };
  count(plain);
  const strings = [...counts].filter(([, n]) => n > 1).map(([value]) => value);
  if (!strings.length) return legacy;
  const indexes = new Map(strings.map((value, index) => [value, index]));
  const encode = (value: JsonValue): EncodedValue => {
    if (typeof value === 'string') {
      const index = indexes.get(value);
      return index === undefined ? value : { ref: index };
    }
    if (Array.isArray(value)) return { array: value.map(encode) };
    if (value && typeof value === 'object') return { object: Object.entries(value).map(([key, item]) => [key, encode(item)]) };
    return value;
  };
  const compact = JSON.stringify({ version: 2, codec, strings, row: encode(plain) });
  if (compact.length >= legacy.length) return legacy;
  // Check the complete round trip before durable storage and before any RPC.
  if (JSON.stringify(deserializeLoadCreation(JSON.parse(compact))) !== legacy) throw invalid();
  return compact;
}

export function deserializeLoadCreation(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('version' in value) || value.version !== 2) return value;
  if (!('codec' in value) || value.codec !== codec || !('strings' in value) || !Array.isArray(value.strings)
    || value.strings.some(item => typeof item !== 'string') || new Set(value.strings).size !== value.strings.length
    || !('row' in value) || Object.keys(value).length !== 4) throw invalid();
  const strings: string[] = value.strings;
  const decode = (node: unknown): JsonValue => {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return node;
    if (typeof node === 'number' && Number.isFinite(node)) return node;
    if (!node || typeof node !== 'object' || Array.isArray(node) || Object.keys(node).length !== 1) throw invalid();
    if ('ref' in node) {
      if (typeof node.ref !== 'number' || !Number.isInteger(node.ref) || node.ref < 0 || node.ref >= strings.length) throw invalid();
      return strings[node.ref];
    }
    if ('array' in node && Array.isArray(node.array)) return node.array.map(decode);
    if ('object' in node && Array.isArray(node.object)) {
      const seen = new Set<string>();
      const entries: [string, JsonValue][] = node.object.map((entry: unknown) => {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || seen.has(entry[0])) throw invalid();
        seen.add(entry[0]);return [entry[0], decode(entry[1])];
      });
      return Object.fromEntries(entries);
    }
    throw invalid();
  };
  return decode(value.row);
}
