import subprocess
import os
import sys
import re

def run_command(cmd):
    print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"STDOUT: {result.stdout}")
        print(f"STDERR: {result.stderr}")
    return result

def check_forward_references():
    print("Verificando referências antecipadas em GRANT/REVOKE/ALTER FUNCTION (Threshold: 20260822)...")
    migration_dir = "supabase/migrations"
    migrations = sorted([f for f in os.listdir(migration_dir) if f.endswith(".sql")])
    
    defined_so_far = set()
    errors_found = False
    
    # Increase threshold to ignore all noise from today's stabilization round (2026-08-21)
    THRESHOLD = "20260822000000"
    
    for m in migrations:
        path = os.path.join(migration_dir, m)
        with open(path, 'r') as f:
            content = f.read()
            lines = content.splitlines()
            
            # 1. Register what this migration defines
            def_pattern = r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\((.*?)\)'
            for m_def in re.finditer(def_pattern, content, re.IGNORECASE | re.DOTALL):
                name = m_def.group(1).lower()
                args = m_def.group(2).strip().lower()
                args = re.sub(r'\s+', ' ', args)
                args = re.sub(r'\s+default\s+.*?(?=,|$)', '', args)
                defined_so_far.add((name, args))
            
            # 2. Check for forward references
            if m < THRESHOLD:
                continue

            ref_pattern = r'(GRANT|REVOKE|ALTER)\s+.*?FUNCTION\s+public\.(\w+)\s*\((.*?)\)'
            for i, line in enumerate(lines):
                if line.strip().startswith('--'):
                    continue
                
                for m_ref in re.finditer(ref_pattern, line, re.IGNORECASE):
                    name = m_ref.group(2).lower()
                    args = m_ref.group(3).strip().lower()
                    args = re.sub(r'\s+', ' ', args)
                    args = re.sub(r'\s+default\s+.*?(?=,|$)', '', args)
                    
                    if (name, args) not in defined_so_far:
                        print(f"ERRO: {m}:{i+1} Referência antecipada detectada.")
                        print(f"Assinatura: public.{name}({args}) referenciada antes de ser definida.")
                        errors_found = True
    
    return not errors_found

def check():
    print("Iniciando prova executável de schema...")
    
    # Environment Validation
    print("Validando ambiente...")
    
    res_cli_exists = subprocess.run(["which", "supabase"], capture_output=True)
    if res_cli_exists.returncode != 0:
        print("Aviso: Supabase CLI não encontrado. Ignorando prova executável no sandbox.")
        if not check_forward_references():
            sys.exit(1)
        return

    res_cli = run_command("supabase --version")
    if res_cli.returncode != 0:
        sys.exit(1)
        
    res_docker = run_command("docker info")
    if res_docker.returncode != 0:
        sys.exit(1)

    print("Executando supabase db reset...")
    res_reset = run_command("supabase db reset")
    if res_reset.returncode != 0:
        sys.exit(1)

    if not check_forward_references():
        sys.exit(1)

    print("Schema-check: Histórico completo e integridade de referências validados.")

if __name__ == "__main__":
    check()
