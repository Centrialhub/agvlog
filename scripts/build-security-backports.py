"""Offline, deterministic security backports from pinned upstream npm tarballs.

No registry upload, package-manager resolution, upstream release claim or scripts.
Existing output is verified byte-for-byte and never overwritten.
"""
import argparse
import base64
import gzip
import hashlib
import io
import json
import pathlib
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--source-directory', required=True)
parser.add_argument('--output-directory', default=str(pathlib.Path(__file__).resolve().parents[1]))
args = parser.parse_args()
root = pathlib.Path(args.output_directory).resolve()
sources = pathlib.Path(args.source_directory).resolve()
pins = [
    ('node-forge', '1.4.0', '1.4.1-agvlog.2', 'sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ=='),
    ('braces', '3.0.3', '3.0.4-agvlog.1', 'sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA=='),
]

def digest(value):
    return hashlib.sha256(value).hexdigest()

def write_new(target, value):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        assert target.read_bytes() == value, str(target) + ' differs; preserved'
    else:
        target.write_bytes(value)

for name, version, patched, integrity in pins:
    data = (sources / (name + '-' + version + '.tgz')).read_bytes()
    assert 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode() == integrity
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for item in archive:
            assert not item.issym() and not item.islnk()
            if item.isfile():
                relative = pathlib.PurePosixPath(item.name)
                assert relative.parts[0] == 'package' and '..' not in relative.parts
                files[str(relative.relative_to('package'))] = archive.extractfile(item).read()
    changes = []
    if name == 'node-forge':
        files = {file: value for file, value in files.items() if not file.startswith(('dist/', 'flash/'))}
        file = 'lib/rsa.js'
        before = files[file].decode()
        old = '            obj.value.length !== 2) {'
        assert before.count(old) == 1
        new = """            obj.value.length !== 2 ||
            obj.value[0].value.length !==
              (('parameters' in capture) ? 2 : 1) ||
            ('parameters' in capture && capture.parameters !== '')) {"""
        references = ['https://github.com/digitalbazaar/forge/pull/1152', 'https://github.com/digitalbazaar/forge/pull/1157']
    else:
        file = 'lib/parse.js'
        before = files[file].decode()
        old = '      stack.push(block);'
        assert before.count(old) == 2
        new = """      // AGVLOG security backport: bound recursive downstream AST walkers.
      // Covers both braces and parentheses; callers cannot disable the bound.
      if (stack.length >= 128) {
        throw new SyntaxError('Maximum pattern nesting depth (128) exceeded');
      }
      stack.push(block);"""
        references = ['https://github.com/advisories/GHSA-vfj7-8cjw-p6xm', 'https://github.com/micromatch/braces/issues/70']
    files[file] = before.replace(old, new).encode()
    changes.append({'path': file, 'beforeSha256': digest(before.encode()), 'afterSha256': digest(files[file])})
    package = json.loads(files['package.json'])
    if name == 'node-forge':
        package['files'] = [file for file in package['files'] if not file.startswith(('dist/', 'flash/'))]
    package.update(version=patched, private=True, type='commonjs', agvlogBackport={
        'upstreamVersion': version, 'officialUpstreamRelease': False, 'securityChanges': changes, 'references': references})
    files['package.json'] = (json.dumps(package, indent=2, ensure_ascii=False) + '\n').encode()
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for relative, value in sorted(files.items()):
                item = tarfile.TarInfo('package/' + relative)
                item.size = len(value)
                item.mode = 0o644
                item.mtime = 0
                archive.addfile(item, io.BytesIO(value))
    tarball = buffer.getvalue()
    relative = 'vendor/' + name + '-' + patched + '.tgz'
    write_new(root / relative, tarball)
    provenance = {'formatVersion': 1, 'upstream': {'name': name, 'version': version,
        'url': 'https://registry.npmjs.org/' + name + '/-/' + name + '-' + version + '.tgz',
        'integrity': integrity, 'tarballSha256': digest(data)}, 'localVersion': patched,
        'officialUpstreamRelease': False, 'tarball': relative, 'sha256': digest(tarball),
        'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(tarball).digest()).decode(),
        'securityChanges': changes, 'references': references,
        'fileHashes': {file: digest(value) for file, value in sorted(files.items())}}
    if name == 'node-forge':
        provenance['excludedUnpatchedUpstreamDirectories'] = ['dist', 'flash']
    write_new(root / ('vendor/' + name + '-' + patched + '.provenance.json'), (json.dumps(provenance, indent=2) + '\n').encode())
    if name == 'node-forge':
        for file, value in files.items():
            write_new(root / 'supabase/functions/_shared/vendor/forge' / file, value)
    print(json.dumps({'name': name, 'version': patched, 'sha256': digest(tarball)}))
