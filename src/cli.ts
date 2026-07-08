#!/usr/bin/env node

// Dispatcher: `accessible-web-scanner <source>` runs the a11y scan;
// `accessible-web-scanner lighthouse <source>` and `accessible-web-scanner all <source>`
// route to the other tools. Everything after the subcommand is passed through.
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TOOLS: Record<string, string> = {
  a11y: 'index.js',
  lighthouse: 'lighthouse.js',
  all: 'all.js',
};

const args = process.argv.slice(2);
const sub = args[0] && TOOLS[args[0]] ? args.shift()! : 'a11y';
const script = join(__dirname, TOOLS[sub]);

const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(`Failed to start ${sub}: ${error.message}`);
  process.exit(1);
});
