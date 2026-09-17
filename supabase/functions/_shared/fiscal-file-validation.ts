export type FiscalFileFormat = 'pdf' | 'xml' | 'cancel_xml';

export const FISCAL_FILE_HEADER_BYTES = 64 * 1024;

const startsWith = (bytes: Uint8Array, signature: number[]) =>
  signature.every((value, index) => bytes[index] === value);

function xmlRootName(text: string): string | null {
  let source = text.replace(/^\uFEFF/, '').trimStart();
  if (!source || /<!doctype\b/i.test(source) || /<(?:[A-Za-z_][\w.-]*:)?(?:html|script)\b/i.test(source)) {
    return null;
  }

  if (/^<\?xml\b/i.test(source)) {
    const declarationEnd = source.indexOf('?>');
    if (declarationEnd < 0) return null;
    source = source.slice(declarationEnd + 2).trimStart();
  }

  // Comments may precede the document element. Other processing instructions
  // are not part of the fiscal transport contract and remain fail-closed.
  // Bound the loop so malformed input cannot turn header inspection into work
  // proportional to the number of empty prefixes.
  for (let prefixCount = 0; prefixCount < 32; prefixCount += 1) {
    if (source.startsWith('<!--')) {
      const commentEnd = source.indexOf('-->');
      if (commentEnd < 0) return null;
      source = source.slice(commentEnd + 3).trimStart();
      continue;
    }
    break;
  }

  const root = /^<([A-Za-z_][\w:.-]*)(?:\s|\/?>)/.exec(source)?.[1];
  if (!root) return null;
  return root.split(':').at(-1)?.toLowerCase() || null;
}

export function isFiscalFileHeaderValid(bytes: Uint8Array, format: FiscalFileFormat): boolean {
  if (!bytes.byteLength) return false;
  if (format === 'pdf') return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);

  const root = xmlRootName(new TextDecoder().decode(bytes));
  return root !== null && root !== 'html' && root !== 'script';
}
