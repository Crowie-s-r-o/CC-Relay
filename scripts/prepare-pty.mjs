import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// node-pty 1.1.0's npm prebuilds ship spawn-helper without its executable bit.
// Fix the installed assets before Electron copies them into the signed bundle.
const require = createRequire(import.meta.url);
const root = dirname(require.resolve('node-pty/package.json'));
for (const directory of ['build/Release', ...(
  existsSync(join(root, 'prebuilds'))
    ? readdirSync(join(root, 'prebuilds')).map((name) => `prebuilds/${name}`) : []
)]) {
  const helper = join(root, directory, 'spawn-helper');
  if (existsSync(helper)) chmodSync(helper, 0o755);
}
