import hashlib
import sys
import os

MANIFEST_PATH = 'supabase/migrations/MANIFEST.sha256'

def get_actual_hashes():
    hashes = {}
    for filename in sorted(os.listdir('supabase/migrations')):
        if filename.endswith('.sql'):
            path = os.path.join('supabase/migrations', filename)
            with open(path, 'rb') as f:
                hashes[filename] = hashlib.sha256(f.read()).hexdigest()
    return hashes

def read_manifest():
    hashes = {}
    if not os.path.exists(MANIFEST_PATH):
        return None
    with open(MANIFEST_PATH, 'r') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) == 2:
                # manifest format: hash filename (or path)
                h, p = parts
                fname = os.path.basename(p)
                hashes[fname] = h
    return hashes

def check():
    manifest = read_manifest()
    if manifest is None:
        print("Error: MANIFEST.sha256 not found.")
        sys.exit(1)
        
    actual = get_actual_hashes()
    
    failed = False
    for fname, expected_hash in manifest.items():
        if fname not in actual:
            print(f"Error: Migration {fname} missing from disk.")
            failed = True
        elif actual[fname] != expected_hash:
            print(f"Error: Migration {fname} has been modified (SHA mismatch).")
            failed = True
            
    if failed:
        sys.exit(1)
    print("Migration integrity OK.")

if __name__ == "__main__":
    check()
