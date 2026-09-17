/* eslint-disable @typescript-eslint/no-explicit-any */
import forgeModule from 'node-forge';

const forge = forgeModule as any;

export interface ParsedFiscalCertificate {
  certificatePem: string;
  privateKeyPem: string;
  certificateCnpj: string | null;
  validFrom: Date;
  validTo: Date;
  serialNumber: string;
  subjectName: string;
  thumbprint: string;
}

export async function parseFiscalPkcs12(bytes: Uint8Array, password: string): Promise<ParsedFiscalCertificate> {
  let p12: any;
  try {
    const der = forge.util.createBuffer(bytesToBinary(bytes));
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, password);
  } catch {
    throw new Error('Não foi possível abrir o certificado. Confira a senha e o arquivo.');
  }
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const privateKey = keyBags.find((bag: any) => bag.key)?.key;
  if (!privateKey || certBags.length === 0) throw new Error('O PFX não contém chave privada e certificado');
  const certificates = certBags.map((bag: any) => bag.cert).filter(Boolean);
  const leaf = certificates.find((certificate: any) => publicKeyMatches(privateKey, certificate.publicKey)) || certificates[0];
  const certificatePem = [leaf, ...certificates.filter((certificate: any) => certificate !== leaf)]
    .map((certificate: any) => forge.pki.certificateToPem(certificate)).join('');
  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
  const derLeaf = forge.asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes();
  const raw = new Uint8Array(derLeaf.length);
  for (let index = 0; index < derLeaf.length; index++) raw[index] = derLeaf.charCodeAt(index);
  return {
    certificatePem,
    privateKeyPem,
    certificateCnpj: extractCertificateCnpj(leaf),
    validFrom: new Date(leaf.validity.notBefore),
    validTo: new Date(leaf.validity.notAfter),
    serialNumber: String(leaf.serialNumber || ''),
    subjectName: leaf.subject.attributes.map((attribute: any) => attribute.value).filter(Boolean).join(', '),
    thumbprint: await sha256Hex(raw),
  };
}

export function extractCertificateCnpj(certificate: any): string | null {
  const official = extractIcpBrasilOtherNameValues(certificate, '2.16.76.1.3.3')
    .flatMap(validCnpjCandidates);
  if (official.length > 0) return official[0];

  const subjectValues = (certificate.subject?.attributes || [])
    .map((attribute: any) => String(attribute.value || ''));
  return subjectValues.flatMap(validCnpjCandidates)[0] || null;
}

function extractIcpBrasilOtherNameValues(certificate: any, expectedOid: string): string[] {
  const values: string[] = [];
  for (const extension of certificate.extensions || []) {
    if (extension.name !== 'subjectAltName' && extension.id !== '2.5.29.17') continue;
    for (const altName of extension.altNames || []) {
      if (altName.type !== 0) continue;
      let otherName = altName.value;
      if (typeof otherName === 'string') {
        try {
          otherName = forge.asn1.fromDer(forge.util.createBuffer(otherName));
        } catch {
          continue;
        }
      }
      const nodes: any[] = [];
      visitAsn1Nodes(otherName, node => nodes.push(node));
      const oid = nodes.find(node =>
        node?.tagClass === forge.asn1.Class.UNIVERSAL && node?.type === forge.asn1.Type.OID
      );
      if (!oid) continue;
      try {
        if (forge.asn1.derToOid(oid.value) !== expectedOid) continue;
      } catch {
        continue;
      }
      for (const node of nodes) {
        if (node === oid || typeof node?.value !== 'string') continue;
        values.push(node.value);
      }
    }
  }
  return values;
}

function visitAsn1Nodes(value: unknown, visit: (node: any) => void, depth = 0): void {
  if (depth > 8 || value == null) return;
  if (Array.isArray(value)) {
    value.forEach(item => visitAsn1Nodes(item, visit, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  const node = value as any;
  if ('tagClass' in node && 'type' in node && 'value' in node) visit(node);
  visitAsn1Nodes(node.value, visit, depth + 1);
}

function validCnpjCandidates(value: string): string[] {
  const digits = Array.from(value, character => /\d/.test(character) ? character : '').join('');
  const candidates: string[] = [];
  for (let index = 0; index <= digits.length - 14; index++) {
    const candidate = digits.slice(index, index + 14);
    if (isValidCnpj(candidate) && !candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}
export function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) return false;
  const calculate = (length: number) => {
    let total = 0;
    let weight = length - 7;
    for (let index = 0; index < length; index++) {
      total += Number(cnpj[index]) * weight--;
      if (weight < 2) weight = 9;
    }
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(cnpj[12]) && calculate(13) === Number(cnpj[13]);
}

function publicKeyMatches(privateKey: any, publicKey: any): boolean {
  return privateKey?.n && publicKey?.n && privateKey.n.compareTo(publicKey.n) === 0;
}

function bytesToBinary(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}



async function sha256Hex(bytes: BufferSource): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}
