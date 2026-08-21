#!/usr/bin/env python3
"""Prova executável de schema.

Duas etapas obrigatórias, sem exclusão por data e sem fallback verde:

1. Análise estática de TODAS as migrations em ordem cronológica: cada
   GRANT/REVOKE/ALTER FUNCTION deve referenciar uma assinatura já criada por um
   CREATE [OR REPLACE] FUNCTION anterior (ou no mesmo arquivo, acima da linha).
   Assinaturas são normalizadas conforme os argumentos de identidade do
   PostgreSQL: apenas tipos de entrada (OUT é descartado), nomes de parâmetros e
   DEFAULT são ignorados, arrays e tipos qualificados por schema são preservados.

2. `supabase db reset` é obrigatório. Se a Supabase CLI ou o Docker não estiverem
   disponíveis, o script encerra com código diferente de zero — nunca há sucesso
   sem o reset executado.
"""

import os
import re
import subprocess
import sys

MIGRATIONS_DIR = "supabase/migrations"

TYPE_ALIASES = {
    "int": "integer",
    "int2": "smallint",
    "int4": "integer",
    "int8": "bigint",
    "serial": "integer",
    "bigserial": "bigint",
    "bool": "boolean",
    "varchar": "character varying",
    "char": "character",
    "float4": "real",
    "float8": "double precision",
    "timestamptz": "timestamp with time zone",
    "timetz": "time with time zone",
    "decimal": "numeric",
}

# Palavras que iniciam um nome de tipo (usado para distinguir "nome tipo" de "tipo").
TYPE_HEAD_WORDS = {
    "anyarray", "anyelement", "anyenum", "anynonarray", "anyrange", "bigint",
    "bigserial", "bit", "bool", "boolean", "box", "bytea", "char", "character",
    "cidr", "circle", "citext", "date", "daterange", "decimal", "double",
    "float4", "float8", "inet", "int", "int2", "int4", "int8", "integer",
    "interval", "json", "jsonb", "line", "lseg", "macaddr", "money", "numeric",
    "numrange", "oid", "path", "point", "polygon", "real", "record", "regclass",
    "regproc", "serial", "smallint", "smallserial", "text", "time",
    "timestamp", "timestamptz", "timetz", "trigger", "tsquery", "tsrange",
    "tstzrange", "tsvector", "uuid", "varbit", "varchar", "void", "xml",
    "geography", "geometry", "app_role",
}

MODES = {"in", "out", "inout", "variadic"}


def _dollar_tag(text, i):
    """Se text[i] inicia uma dollar-quote, retorna a tag completa ($$ ou $tag$)."""
    if text[i] != "$":
        return None
    j = i + 1
    while j < len(text) and (text[j].isalnum() or text[j] == "_"):
        j += 1
    if j < len(text) and text[j] == "$":
        return text[i : j + 1]
    return None


def strip_comments(text):
    """Remove comentários -- e /* */ preservando offsets, linhas e literais SQL."""
    out = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        tag = _dollar_tag(text, i)
        if tag:
            end = text.find(tag, i + len(tag))
            end = n if end == -1 else end + len(tag)
            out.append(text[i:end])
            i = end
            continue
        if ch in ("'", '"'):
            j = i + 1
            while j < n:
                if text[j] == ch:
                    if j + 1 < n and text[j + 1] == ch:
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            out.append(text[i:j])
            i = j
            continue
        if ch == "-" and text.startswith("--", i):
            j = text.find("\n", i)
            if j == -1:
                j = n
            out.append(" " * (j - i))
            i = j
            continue
        if ch == "/" and text.startswith("/*", i):
            j = text.find("*/", i + 2)
            j = n if j == -1 else j + 2
            out.append("".join("\n" if c == "\n" else " " for c in text[i:j]))
            i = j
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def split_statements(content, base=0):
    """Divide SQL em instruções de nível superior.

    Respeita strings, identificadores citados, dollar-quotes e parênteses. Não
    divide dentro de corpos dollar-quoted (funções e blocos DO). Retorna
    [(offset_absoluto, texto_da_instrucao)].
    """
    statements = []
    start = 0
    depth = 0
    i = 0
    n = len(content)
    while i < n:
        ch = content[i]
        tag = _dollar_tag(content, i)
        if tag:
            end = content.find(tag, i + len(tag))
            i = n if end == -1 else end + len(tag)
            continue
        if ch in ("'", '"'):
            j = i + 1
            while j < n:
                if content[j] == ch:
                    if j + 1 < n and content[j + 1] == ch:
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            i = j
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif ch == ";" and depth == 0:
            stmt = content[start:i]
            if stmt.strip():
                statements.append((base + start, stmt))
            start = i + 1
        i += 1
    if content[start:].strip():
        statements.append((base + start, content[start:]))
    return statements



def split_top_level(args):
    parts = []
    depth = 0
    current = []
    for ch in args:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
    if "".join(current).strip():
        parts.append("".join(current))
    return parts


def normalize_type(raw):
    t = raw.strip().lower()
    array_suffix = ""
    while t.endswith("]"):
        idx = t.rfind("[")
        if idx == -1:
            break
        array_suffix += "[]"
        t = t[:idx].strip()
    if t.endswith(" array"):
        array_suffix += "[]"
        t = t[: -len(" array")].strip()
    # remove modificadores de tipo: numeric(10,2) -> numeric
    t = re.sub(r"\((?:[^()]*)\)\s*$", "", t).strip()
    t = re.sub(r"\s+", " ", t)
    if "." in t:
        schema, _, bare = t.rpartition(".")
        # public./pg_catalog. são resolvidos pelo search_path padrão:
        # public.app_role e app_role são a mesma assinatura.
        if schema in ("public", "pg_catalog"):
            t = TYPE_ALIASES.get(bare, bare)
        else:
            t = f"{schema}.{bare}"
    else:
        t = TYPE_ALIASES.get(t, t)
    return t + array_suffix



def normalize_arg(raw):
    """Retorna o tipo de identidade do argumento, ou None se for OUT/vazio."""
    arg = re.sub(r"\s+", " ", raw.strip())
    if not arg:
        return None
    # remove DEFAULT ... e = ...
    arg = re.split(r"\s+default\s+", arg, flags=re.IGNORECASE)[0]
    arg = arg.split("=")[0].strip()
    if not arg:
        return None
    tokens = arg.split(" ")
    mode = None
    if tokens[0].lower() in MODES:
        mode = tokens[0].lower()
        tokens = tokens[1:]
    if mode == "out":
        return None
    if not tokens:
        return None
    if len(tokens) > 1:
        head = tokens[0].lower().split("(")[0].split("[")[0].split(".")[0]
        if head not in TYPE_HEAD_WORDS:
            # primeiro token é nome de parâmetro
            tokens = tokens[1:]
    if not tokens:
        return None
    return normalize_type(" ".join(tokens))


def normalize_signature(name, args_raw):
    args = [normalize_arg(a) for a in split_top_level(args_raw)]
    args = [a for a in args if a]
    return f"{name.lower()}({', '.join(args)})"


def read_balanced_args(content, open_idx):
    """Lê os argumentos a partir do '(' em open_idx, respeitando aninhamento."""
    depth = 0
    for i in range(open_idx, len(content)):
        ch = content[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return content[open_idx + 1 : i], i
    return None, None


DEF_RE = re.compile(
    r"\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(\w+)\.)?(\w+)\s*\(",
    re.IGNORECASE,
)
ALTER_FUNC_RE = re.compile(
    r"\bALTER\s+FUNCTION\s+(?:(\w+)\.)?(\w+)\s*\(",
    re.IGNORECASE,
)
GRANT_HEAD_RE = re.compile(r"^\s*(GRANT|REVOKE)\b", re.IGNORECASE)
ON_FUNCTION_RE = re.compile(r"\bON\s+(?:ALL\s+FUNCTIONS|FUNCTION)\b", re.IGNORECASE)
DO_RE = re.compile(r"^\s*DO\b", re.IGNORECASE)
FUNC_REF_RE = re.compile(r"^\s*(?:(\w+)\.)?(\w+)\s*\(", re.IGNORECASE)


def mask_dollar_bodies(text):
    """Substitui corpos dollar-quoted por espaços (preservando linhas).

    Usado para impedir que 'CREATE FUNCTION'/strings dentro de corpos de
    funções e blocos DO sejam lidos como definições de nível superior.
    """
    out = []
    i = 0
    n = len(text)
    while i < n:
        tag = _dollar_tag(text, i)
        if tag:
            end = text.find(tag, i + len(tag))
            end = n if end == -1 else end + len(tag)
            out.append("".join("\n" if c == "\n" else " " for c in text[i:end]))
            i = end
            continue
        out.append(text[i])
        i += 1
    return "".join(out)



def read_balanced_args_from(text, open_idx):
    """Alias legado de read_balanced_args."""
    return read_balanced_args(text, open_idx)


def _grant_function_targets(stmt):
    """Extrai os alvos de `GRANT/REVOKE ... ON FUNCTION a(...), b(...)`."""
    m = ON_FUNCTION_RE.search(stmt)
    if not m or m.group(0).upper().endswith("FUNCTIONS"):
        return []
    rest = stmt[m.end() :]
    # corta em TO/FROM de nível superior (fora de parênteses)
    depth = 0
    cut = len(rest)
    i = 0
    while i < len(rest):
        ch = rest[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif depth == 0:
            mk = re.match(r"\s(?:TO|FROM)\s", rest[i : i + 6], re.IGNORECASE)
            if mk:
                cut = i
                break
        i += 1
    targets = []
    for part in split_top_level(rest[:cut]):
        pm = FUNC_REF_RE.match(part)
        if not pm:
            continue
        args_raw, _ = read_balanced_args(part, pm.end() - 1)
        if args_raw is None:
            continue
        schema = (pm.group(1) or "public").lower()
        targets.append((f"{schema}.{pm.group(2).lower()}", args_raw))
    return targets


def line_of(content, offset):
    return content.count("\n", 0, offset) + 1


def collect_events(content, base=0):
    """Retorna [(offset, kind, action, qualified_name, args_raw)] em ordem.

    Analisa apenas instruções de nível superior: reconhece CREATE FUNCTION,
    ALTER FUNCTION e GRANT/REVOKE ... ON FUNCTION dentro da MESMA instrução.
    Blocos DO são analisados recursivamente em seu corpo dollar-quoted.
    """
    events = []
    for offset, stmt in split_statements(content, base):
        masked = mask_dollar_bodies(stmt)
        m = DEF_RE.search(masked)
        if m:
            args_raw, _ = read_balanced_args(masked, m.end() - 1)
            if args_raw is not None:
                schema = (m.group(1) or "public").lower()
                events.append(
                    (offset, "def", "CREATE FUNCTION", f"{schema}.{m.group(2).lower()}", args_raw)
                )
            continue
        m = ALTER_FUNC_RE.search(masked)
        if m:
            args_raw, _ = read_balanced_args(masked, m.end() - 1)
            if args_raw is not None:
                schema = (m.group(1) or "public").lower()
                events.append(
                    (offset, "ref", "ALTER", f"{schema}.{m.group(2).lower()}", args_raw)
                )
            continue
        m = GRANT_HEAD_RE.match(stmt)
        if m:
            action = m.group(1).upper()
            for qname, args_raw in _grant_function_targets(stmt):
                events.append((offset, "ref", action, qname, args_raw))
            continue
        if DO_RE.match(stmt):
            dollar = re.search(r"\$(\w*)\$", stmt)
            if dollar:
                tag = dollar.group(0)
                body_start = dollar.end()
                end = stmt.find(tag, body_start)
                body = stmt[body_start : end if end != -1 else len(stmt)]
                events.extend(collect_events(body, base=offset + body_start))
    events.sort(key=lambda e: e[0])
    return events


def check_forward_references():
    print("Analisando assinaturas de funções em todas as migrations (ordem cronológica)...")
    if not os.path.isdir(MIGRATIONS_DIR):
        print(f"ERRO: diretório ausente: {MIGRATIONS_DIR}")
        return False

    migrations = sorted(f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql"))
    defined = set()
    errors = 0

    for filename in migrations:
        with open(os.path.join(MIGRATIONS_DIR, filename), "r", encoding="utf-8") as fh:
            content = strip_comments(fh.read())

        events = collect_events(content)

        for offset, kind, action, qname, args_raw in events:
            schema, _, bare = qname.partition(".")
            signature = normalize_signature(bare, args_raw)
            key = f"{schema}.{signature}"
            if kind == "def":
                defined.add(key)
            elif key not in defined:
                errors += 1
                print(
                    f"ERRO: {filename}:{line_of(content, offset)} "
                    f"[{action} FUNCTION] assinatura não definida anteriormente: {key}"
                )

    if errors:
        print(f"Análise de assinaturas FALHOU ({errors} referência(s) antecipada(s)).")
        return False
    print(f"Análise de assinaturas OK ({len(migrations)} migrations).")
    return True



def run_command(cmd):
    print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"STDOUT: {result.stdout}")
        print(f"STDERR: {result.stderr}")
    return result


def check():
    print("Iniciando prova executável de schema...")
    static_ok = check_forward_references()

    print("Validando ambiente (Supabase CLI e Docker são obrigatórios)...")
    if subprocess.run(["which", "supabase"], capture_output=True).returncode != 0:
        print("ERRO: Supabase CLI não encontrada. `supabase db reset` é obrigatório.")
        sys.exit(1)
    if run_command("supabase --version").returncode != 0:
        print("ERRO: Supabase CLI inoperante.")
        sys.exit(1)
    if run_command("docker info").returncode != 0:
        print("ERRO: Docker indisponível. `supabase db reset` é obrigatório.")
        sys.exit(1)

    print("Executando supabase db reset...")
    if run_command("supabase db reset").returncode != 0:
        print("ERRO: supabase db reset falhou.")
        sys.exit(1)

    if not static_ok:
        sys.exit(1)

    print("Schema-check: histórico completo e integridade de assinaturas validados.")


if __name__ == "__main__":
    check()
