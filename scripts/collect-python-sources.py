"""Retain exact installed source distributions and license metadata with the helper."""
import hashlib
import importlib.metadata
import json
import sys
from pathlib import Path
import urllib.request

output = Path('vendor/source')
output.mkdir(parents=True, exist_ok=True)
records = []
for distribution in sorted(importlib.metadata.distributions(), key=lambda item: item.metadata['Name'].lower()):
    name, version = distribution.metadata['Name'], distribution.version
    request = urllib.request.Request(f'https://pypi.org/pypi/{name}/{version}/json', headers={'User-Agent': 'Papan-source-archive/0.1'})
    with urllib.request.urlopen(request, timeout=60) as response:
        metadata = json.load(response)
    source = next((file for file in metadata['urls'] if file['packagetype'] == 'sdist'), None)
    if not source:
        raise RuntimeError(f'No source distribution available for {name} {version}')
    target = output / source['filename']
    expected = source['digests']['sha256']
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != expected:
        with urllib.request.urlopen(source['url'], timeout=90) as response:
            contents = response.read()
        if hashlib.sha256(contents).hexdigest() != expected:
            raise RuntimeError(f'Source checksum mismatch: {name}')
        target.write_bytes(contents)
    records.append({'name': name, 'version': version, 'license': distribution.metadata.get('License-Expression') or distribution.metadata.get('License'),
                    'source': source['url'], 'file': target.name, 'sha256': expected})
(output / 'python-sources.json').write_text(json.dumps(records, indent=2) + '\n')
(output / 'requirements-installed.txt').write_text(''.join(f'{item["name"]}=={item["version"]}\n' for item in records))
print(f'Retained {len(records)} exact Python source distributions.')
python_version = '.'.join(str(part) for part in sys.version_info[:3])
with urllib.request.urlopen(f'https://raw.githubusercontent.com/python/cpython/v{python_version}/LICENSE', timeout=60) as response:
    (output / 'Python-LICENSE').write_bytes(response.read())
(output / 'python-runtime.txt').write_text(f'CPython {python_version}\nhttps://github.com/python/cpython/tree/v{python_version}\n')
