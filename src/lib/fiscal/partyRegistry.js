/**
 * Resolução de partes do CT-e (remetente, destinatário, consignatário, etc.)
 * contra o cadastro local de clientes/fornecedores.
 *
 * Motivo: muitas NF-es chegam sem CNPJ, IE ou endereço completo. Sem esses
 * dados o Hub Fiscal rejeita a emissão por "falta de dados das partes".
 * Aqui casamos a parte com o cadastro por (1) id, (2) CNPJ, (3) nome
 * normalizado, e completamos SOMENTE o que estiver faltando.
 */
export const digitsOnly = (v) => (v || '').replace(/\D+/g, '');
/**
 * Sanitiza Inscrição Estadual antes de usar no CT-e.
 *
 * O auto-cadastro de clientes grava 'UNKNOWN' quando a IE lida da NF/OCR é
 * ilegível ou incompatível com a UF. Esse marcador NUNCA pode ir para o Hub
 * Fiscal/SEFAZ (rejeita o documento) nem preencher o campo do diálogo.
 * Retorna null para marcadores inválidos, 'ISENTO' quando isento e os dígitos
 * nos demais casos.
 */
export function sanitizeIe(v) {
    const raw = (v || '').trim();
    if (!raw)
        return null;
    const upper = raw.toUpperCase();
    if (/^(UNKNOWN|DESCONHECID[OA]|ILEG[IÍ]VEL|N\/?I|N\/?A|NAO INFORMAD[OA]|-+|\?+|0+)$/.test(upper)) {
        return null;
    }
    if (/^(ISENTO|ISENTA|IS|EX)$/.test(upper))
        return 'ISENTO';
    const digits = digitsOnly(raw);
    return digits || null;
}
/** Nome comparável: sem acento, sem pontuação, sem sufixos societários. */
export function normalizeName(v) {
    return (v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\b(LTDA|LTD|ME|EPP|EIRELI|S\/?A|SA|MEI)\b/g, ' ')
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
}
export function buildClientIndex(clients = []) {
    const byId = new Map();
    const byCnpj = new Map();
    const byName = new Map();
    for (const c of clients || []) {
        if (!c)
            continue;
        if (c.id)
            byId.set(String(c.id), c);
        const k = digitsOnly(c.tax_id);
        if (k && !byCnpj.has(k))
            byCnpj.set(k, c);
        for (const n of [c.company_name, c.legal_name, c.trade_name]) {
            const nk = normalizeName(n);
            if (nk && !byName.has(nk))
                byName.set(nk, c);
        }
    }
    return { byId, byCnpj, byName };
}
/** Acha o cadastro correspondente à parte (id > CNPJ > nome). */
export function findRegistryClient(index, party) {
    if (party.id && index.byId.has(String(party.id)))
        return index.byId.get(String(party.id));
    const k = digitsOnly(party.cnpj);
    if (k && index.byCnpj.has(k))
        return index.byCnpj.get(k);
    const nk = normalizeName(party.name);
    if (nk && index.byName.has(nk))
        return index.byName.get(nk);
    return null;
}
function addressFromClient(c) {
    if (!c)
        return null;
    const addr = {
        street: c.address_street || null,
        number: c.address_number || null,
        complement: c.address_complement || null,
        neighborhood: c.address_neighborhood || null,
        city: c.address_city || null,
        city_ibge: c.address_city_ibge_code || null,
        state: c.address_state || null,
        zip: c.address_zip || null,
    };
    return Object.values(addr).some(Boolean) ? addr : null;
}
/**
 * Monta a parte para o payload completando lacunas com o cadastro local.
 * Só devolve `null` quando não há nome nem cadastro correspondente.
 */
export function resolveParty(index, party, fallbackAddress) {
    const c = findRegistryClient(index, party);
    const name = (party.name || '').trim() || (c?.company_name || c?.legal_name || '').trim();
    if (!name)
        return null;
    const cnpj = digitsOnly(party.cnpj) || digitsOnly(c?.tax_id) || null;
    const ie = sanitizeIe(party.ie) || sanitizeIe(c?.state_registration);
    const fromClient = addressFromClient(c);
    const fallback = fallbackAddress
        ? {
            street: null,
            number: null,
            complement: null,
            neighborhood: null,
            city: fallbackAddress.city || null,
            city_ibge: fallbackAddress.city_ibge || fallbackAddress.codigoMunicipio || null,
            state: fallbackAddress.state || null,
            zip: null,
        }
        : null;
    // Mescla: cadastro preenche o que o fallback (dados da NF) não tem e vice-versa.
    const address = fromClient && fallback
        ? {
            ...fromClient,
            city: fromClient.city || fallback.city,
            city_ibge: fromClient.city_ibge || fallback.city_ibge,
            state: fromClient.state || fallback.state,
        }
        : fromClient || fallback;
    return { name, cnpj, ie, address };
}
/**
 * Completa os campos visíveis do CT-e com o cadastro local (nunca sobrescreve
 * valor já informado). Usado no diálogo para o operador ver o que será enviado.
 */
export function fillPartyFieldsFromRegistry(item, index) {
    const rem = findRegistryClient(index, {
        cnpj: item.remitterCnpj,
        name: item.remitterName,
    });
    const rec = findRegistryClient(index, {
        id: item.clientId,
        cnpj: item.recipientCnpj,
        name: item.recipientName,
    });
    const next = { ...item };
    let changed = false;
    const set = (key, value) => {
        const v = (value ?? '') === null ? '' : String(value ?? '').trim();
        if (!v)
            return;
        if ((next[key] || '').trim())
            return;
        next[key] = v;
        changed = true;
    };
    if (rem) {
        set('remitterName', rem.company_name || rem.legal_name);
        set('remitterCnpj', digitsOnly(rem.tax_id));
        set('remitterIe', sanitizeIe(rem.state_registration));
    }
    if (rec) {
        set('recipientName', rec.company_name || rec.legal_name);
        set('recipientCnpj', digitsOnly(rec.tax_id));
        set('recipientIe', sanitizeIe(rec.state_registration));
        set('recipientCity', rec.address_city);
        set('recipientState', rec.address_state);
    }
    // Limpa marcadores inválidos ('UNKNOWN') que possam ter vindo do cadastro/RPC.
    for (const key of ['remitterIe', 'recipientIe']) {
        const current = (next[key] || '').trim();
        if (!current)
            continue;
        const clean = sanitizeIe(current) || '';
        if (clean !== current) {
            next[key] = clean;
            changed = true;
        }
    }
    return { item: changed ? next : item, changed };
}
