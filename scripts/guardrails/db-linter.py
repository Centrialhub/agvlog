import os
import re
import sys
from pathlib import Path

def check_direct_writes():
    """Detecta escrita direta do frontend em estados canônicos (.ts, .tsx)"""
    print("Auditando escritas diretas no frontend (.ts, .tsx)...")
    canonical_tables = ["loads", "load_items", "dispatch_trips", "dispatch_stops", "fiscal_documents", "operational_ledger"]
    src_dir = Path("src")
    success = True
    
    # Padrão para detectar .from('table').update/insert/delete(
    # Suporta quebras de linha e casts
    for ts_file in src_dir.glob("**/*"):
        if ts_file.suffix not in ['.ts', '.tsx']:
            continue
            
        content = ts_file.read_text()
        lines = content.splitlines()
        
        for table in canonical_tables:
            # Padrão: .from('table') seguido opcionalmente por qualquer coisa e depois um dos métodos proibidos
            # O re.DOTALL permite que o '.' case com quebras de linha
            pattern = rf"\.from\(\s*['\"]{table}['\"]\s*\)(?:[^;]*?)\.(update|insert|delete|upsert)\s*\("
            
            matches = re.finditer(pattern, content, re.MULTILINE | re.DOTALL)
            for match in matches:
                # Calcular número da linha
                start_index = match.start()
                line_no = content.count('\n', 0, start_index) + 1
                
                # Verificar se há exceção específica na linha ou logo acima
                # Formato: // linter:allow-direct-write [tabela] [motivo] [prazo]
                exception_found = False
                context_lines = lines[max(0, line_no-2):line_no]
                for context_line in context_lines:
                    if f"linter:allow-direct-write {table}" in context_line or f"linter:allow-direct-write {table}" in lines[line_no-1]:
                        exception_found = True
                        break
                
                if not exception_found:
                    print(f"ERRO: Escrita direta na tabela canônica '{table}' detectada!")
                    print(f"  Arquivo: {ts_file}:{line_no}")
                    print(f"  Trecho: {match.group(0).strip()[:100]}...")
                    print(f"  Ação: Substitua por chamada RPC ou adicione exceção: // linter:allow-direct-write {table} [motivo] [prazo-YYYY-MM-DD]")
                    success = False
    return success

def check_migrations():
    """Valida se migrations possuem DML sem tenant_id ou search_path"""
    print("Auditando migrations...")
    migration_dir = Path("supabase/migrations")
    success = True
    
    for sql_file in migration_dir.glob("*.sql"):
        content = sql_file.read_text()
        
        # 1. SECURITY DEFINER sem search_path
        if "SECURITY DEFINER" in content.upper() and "SET SEARCH_PATH" not in content.upper():
            if "-- linter:allow-no-search-path" not in content:
                print(f"ERRO: Função SECURITY DEFINER sem search_path em {sql_file.name}")
                success = False

        # 2. DML sem tenant_id (ignora tabelas globais)
        if any(cmd in content.upper() for cmd in ["INSERT INTO", "UPDATE", "DELETE FROM"]) and 'REVOKE' not in content.upper() and 'GRANT' not in content.upper():
            if any(t in content for t in ["integration_accounts", "tenants", "user_roles", "auth.", "app_role"]):
                continue
            if "tenant_id" not in content.lower() and "-- linter:allow-no-tenant" not in content:
                print(f"ERRO: DML sem tenant_id detectado em {sql_file.name}")
                success = False
    return success

if __name__ == "__main__":
    ok = True
    if not check_direct_writes(): ok = False
    if not check_migrations(): ok = False
    
    if not ok:
        print("\nCI FAILED: Guardrails detectaram violações de integridade.")
        sys.exit(1)
    print("\nGuardrails validados com sucesso!")
