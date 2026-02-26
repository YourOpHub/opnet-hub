#!/usr/bin/env node
/**
 * Deploy OPNet Hub to VPS.
 * Set env: VPS_HOST, VPS_USER, VPS_PATH. Optional: SSH_KEY_PATH, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID.
 * Usage: npm run deploy   (or node scripts/deploy.js)
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');

// Load .env if present (no extra deps)
try {
  const envPath = join(root, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
} catch (_) {}

const env = (key, def = '') => (process.env[key] ?? def).trim();
const VPS_HOST = env('VPS_HOST');
const VPS_USER = env('VPS_USER');
const VPS_PATH = env('VPS_PATH');
const SSH_KEY = env('SSH_KEY_PATH') || undefined;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function main() {
  if (!VPS_HOST || !VPS_USER || !VPS_PATH) {
    console.error('Set VPS_HOST, VPS_USER, VPS_PATH (e.g. in .env). See .env.example');
    process.exit(1);
  }

  console.log('Building...');
  await run('npm', ['run', 'build'], { cwd: root });

  const dist = join(root, 'dist');
  if (!existsSync(dist)) {
    console.error('dist/ not found after build');
    process.exit(1);
  }

  const target = `${VPS_USER}@${VPS_HOST}:${VPS_PATH}`;
  const sshOpts = SSH_KEY ? `-e "ssh -i ${SSH_KEY}"` : '';

  console.log('Uploading to', target, '...');
  try {
    await run('rsync', [
      '-avz', '--delete',
      dist + '/',
      target + '/',
    ].filter(Boolean), { cwd: root });
  } catch (e) {
    console.warn('rsync failed, trying scp...');
    await run('scp', ['-r', '-o', 'StrictHostKeyChecking=accept-new', ...(SSH_KEY ? ['-i', SSH_KEY] : []), join(dist, '*'), target + '/'], { cwd: root });
  }

  console.log('Done. Open https://' + (env('LIVE_DOMAIN') || VPS_HOST) + ' (or http if no SSL)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
