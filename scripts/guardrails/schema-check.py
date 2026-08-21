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


def strip_comments(text):
    """Remove comentários -- e /* */ preservando a contagem de linhas."""
    out = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "-" and text.startswith("--", i):
            j = text.find("\n", i)
            if j == -1:
                break
            out.append(" " * (j - i))
            i = j
            continue
        if ch == "/" and text.startswith("/*", i):
            j = text.find("*/", i + 2)
            if j == -1:
                j = n
            else:
                j += 2
            out.append("".join("\n" if c == "\n" else " " for c in text[i:j]))
            i = j
            continue
        out.append(ch)
        i += 1
    return "".join(out)


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
        if schema in ("public", "pg_catalog"):
            t = TYPE_ALIASES.get(bare, bare)
            if schema == "public":
                t = f"public.{t}"
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
    r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(\w+)\.)?(\w+)\s*\(",
    re.IGNORECASE,
)
REF_RE = re.compile(
    r"\b(GRANT|REVOKE|ALTER)\b[\s\S]{0,400}?\bFUNCTION\s+(?:(\w+)\.)?(\w+)\s*\(",
    re.IGNORECASE,
)


def collect(content, pattern, with_action):
    """Retorna [(offset, action, qualified_name, args_raw)]."""
    found = []
    for m in pattern.finditer(content):
        open_idx = m.end() - 1
        args_raw, _ = read_balanced_args(content, open_idx)
        if args_raw is None:
            continue
        if with_action:
            action = m.group(1).upper()
            schema = (m.group(2) or "public").lower()
            fname = m.group(3).lower()
        else:
            action = "CREATE FUNCTION"
            schema = (m.group(1) or "public").lower()
            fname = m.group(2).lower()
        found.append((m.start(), action, f"{schema}.{fname}", args_raw))
    return found


def line_of(content, offset):
    return content.count("\n", 0, offset) + 1


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

        defs = collect(content, DEF_RE, with_action=False)
        refs = collect(content, REF_RE, with_action=True)

        events = [(off, "def", action, qname, args) for off, action, qname, args in defs]
        events += [(off, "ref", action, qname, args) for off, action, qname, args in refs]
        events.sort(key=lambda e: e[0])

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
