import os
import re
import sys
from pathlib import Path

def check_migrations():
    """Valida se migrations possuem DML sem tenant_id"""
    print("Auditando migrations...")
    migration_dir = Path("supabase/migrations")
    success = True
    # Migrações históricas com DML conhecido sem tenant_id
    historical_exceptions = [
        "202603", "202604", "202605", "202606", "202607",
        "2026080", "20260810", "20260811", "20260812"
    ]
    
    for sql_file in migration_dir.glob("*.sql"):
        if any(ex in sql_file.name for ex in historical_exceptions):
            continue
        content = sql_file.read_text()
        if any(cmd in content.upper() for cmd in ["INSERT INTO", "UPDATE", "DELETE FROM"]):
            # Filtros de tabelas globais
            if any(t in content for t in ["integration_accounts", "tenants", "user_roles", "auth.", "app_role"]):
                continue
            if "tenant_id" not in content.lower() and "-- linter:allow-no-tenant" not in content:
                print(f"ERRO: DML sem tenant_id detectado em {sql_file.name}")
                success = False
    return success

def check_security_definer():
    """Verifica SECURITY DEFINER sem search_path"""
    print("Auditando funções SECURITY DEFINER...")
    migration_dir = Path("supabase/migrations")
    success = True
    # Funções SECURITY DEFINER sem search_path em arquivos históricos (se necessário, mas já fixamos alguns)
    historical_exceptions = [
        "202603", "202604", "202605", "202606", "202607", "20260810", "20260811", "20260812"
    ]

    for sql_file in migration_dir.glob("*.sql"):
        if any(ex in sql_file.name for ex in historical_exceptions):
            continue
        content = sql_file.read_text()
        if "SECURITY DEFINER" in content.upper() and "SET search_path" not in content.upper():
            if "-- linter:allow-no-search-path" not in content:
                print(f"ERRO: Função SECURITY DEFINER sem search_path em {sql_file.name}")
                success = False
    return success

def check_direct_writes():
    """Detecta escrita direta do frontend em estados canônicos"""
    print("Auditando escritas diretas no frontend (.ts, .tsx)...")
    canonical_tables = ["loads", "load_items", "dispatch_trips", "dispatch_stops", "fiscal_documents", "operational_ledger"]
    src_dir = Path("src")
    success = True
    
    for ts_file in src_dir.glob("**/*.[t]s*"): # .ts e .tsx
        if ts_file.suffix not in ['.ts', '.tsx']:
            continue
            
        content = ts_file.read_text()
        if "// guardrail:allow-direct-write" in content:
            continue
            
        for table in canonical_tables:
            pattern = rf"\.from\(['\"]{table}['\"]\)(?:\.|\s)*?(?:update|insert|delete)\("
            if re.search(pattern, content.replace("\n", "")):
                print(f"ERRO: Escrita direta na tabela canônica '{table}' em {ts_file}")
                success = False
    return success

if __name__ == "__main__":
    ok = True
    if not check_migrations(): ok = False
    if not check_security_definer(): ok = False
    if not check_direct_writes(): ok = False
    
    if not ok:
        sys.exit(1)
    print("Guardrails operacionais validados!")