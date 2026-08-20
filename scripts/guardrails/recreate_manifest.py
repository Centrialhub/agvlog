import hashlib
import os

def create_manifest():
    manifest_path = 'supabase/migrations/MANIFEST.sha256'
    with open(manifest_path, 'w') as manifest_file:
        for filename in sorted(os.listdir('supabase/migrations')):
            if filename.endswith('.sql'):
                path = os.path.join('supabase/migrations', filename)
                with open(path, 'rb') as f:
                    file_hash = hashlib.sha256(f.read()).hexdigest()
                    manifest_file.write(f"{file_hash}  {filename}\n")
    print(f"Manifest created at {manifest_path}")

if __name__ == "__main__":
    create_manifest()
