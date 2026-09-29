import { packager } from '@electron/packager';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

await access(path.join('vendor', process.platform === 'win32' ? 'papan-extract.exe' : 'papan-extract'));
const outputs = await packager({ dir: '.', name: 'Papan', out: 'dist', overwrite: true, prune: true, asar: false,
  executableName: 'papan', appBundleId: 'id.papan.desktop', appCategoryType: 'public.app-category.lifestyle',
  ignore: [/^\/(test|scripts|docs|artifacts|dist|build|\.venv|\.github|worker)(\/|$)/, /^\/\.git/, /\.log$/],
});
console.log(outputs.join('\n'));
for (const output of outputs) {
  const python = path.join('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const result = spawnSync(python, ['-c', 'import sys,tarfile,os; archive=tarfile.open(sys.argv[1]+".tar.gz","w:gz"); archive.add(sys.argv[1],arcname=os.path.basename(sys.argv[1])); archive.close()', output], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Could not archive the desktop build.');
}
