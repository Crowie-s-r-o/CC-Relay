import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(projectRoot, 'plugin/relay-queue');
const destination = '/Users/patrikkelemen/plugins/relay-queue';

mkdirSync(dirname(destination), { recursive: true });
rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });

const skillRoot = '/Users/patrikkelemen/.codex/skills/.system/plugin-creator';
execFileSync('python3', [
  resolve(skillRoot, 'scripts/update_plugin_cachebuster.py'),
  destination,
], { stdio: 'inherit' });
execFileSync('python3', [
  resolve(skillRoot, 'scripts/validate_plugin.py'),
  destination,
], { stdio: 'inherit' });

const marketplaceName = execFileSync('python3', [
  resolve(skillRoot, 'scripts/read_marketplace_name.py'),
], { encoding: 'utf8' }).trim();

execFileSync('codex', ['plugin', 'add', `relay-queue@${marketplaceName}`], { stdio: 'inherit' });
console.log('Relay Queue installed. Start a new Codex thread before using it.');
