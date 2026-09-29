import { appendFile, access } from 'node:fs/promises';
import path from 'node:path';
const directory = path.resolve('dist', `Papan-${process.platform}-${process.arch}`);
const executable = path.join(directory, process.platform === 'darwin' ? 'Papan.app/Contents/MacOS/papan' : process.platform === 'win32' ? 'papan.exe' : 'papan');
await access(executable);
await appendFile(process.env.GITHUB_ENV, `PAPAN_EXECUTABLE=${executable}\n`);
