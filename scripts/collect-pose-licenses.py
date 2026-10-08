"""Keep pose dependency versions, upstream sources and native license notices."""
import importlib.metadata
import json
from pathlib import Path
import shutil
import sys
import urllib.request

output = Path('vendor/pose-source')
records = []
for name in ('rtmlib', 'numpy', 'opencv-python-headless', 'onnxruntime', 'tqdm', 'flatbuffers', 'packaging', 'protobuf', 'sympy', 'mpmath'):
    distribution = importlib.metadata.distribution(name)
    with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{distribution.version}/json', timeout=60) as response:
        info = json.load(response)
    licenses = []
    for file in distribution.files or ():
        if any(part.lower().startswith(('license', 'notice', 'copyright', 'thirdpartynotice')) for part in file.parts):
            source = Path(distribution.locate_file(file))
            if source.is_file():
                target = output / 'licenses' / name / file
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                licenses.append(str(target.relative_to(output)))
    records.append({'name': name, 'version': distribution.version, 'license': info['info'].get('license_expression') or info['info'].get('license'),
                    'sources': info['info'].get('project_urls'), 'licenses': licenses,
                    'distributions': [{'file': file['filename'], 'url': file['url'], 'sha256': file['digests']['sha256']} for file in info['urls']]})
(output / 'python-packages.json').write_text(json.dumps(records, indent=2) + '\n')
(output / 'models.txt').write_text('DWPose and YOLOX models: Apache-2.0\nhttps://huggingface.co/yzd-v/DWPose/tree/1a7144101628d69ee7a3768d1ee3a094070dc388\nModels download separately; exact file sizes and SHA-256 hashes are in src/pose.js.\n')
print(f'Retained license notices and exact versions for {len(records)} pose dependencies.')

version = '.'.join(map(str, sys.version_info[:3]))
with urllib.request.urlopen(f'https://raw.githubusercontent.com/python/cpython/v{version}/LICENSE', timeout=60) as response:
    (output / 'Python-LICENSE').write_bytes(response.read())
(output / 'python-runtime.txt').write_text(f'CPython {version}\nhttps://github.com/python/cpython/tree/v{version}\n')
