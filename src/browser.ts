import { chromium, Browser } from 'playwright';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);

function installChromium(): Promise<void> {
  // playwright doesn't export its CLI, so locate it next to its package.json.
  const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
  return new Promise((resolve, reject) => {
    // Progress goes to stderr so --json stdout stays clean.
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      stdio: ['ignore', process.stderr, process.stderr],
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Installing Chromium failed (exit ${code}). Run: npx playwright install chromium`))
    );
  });
}

/** Launch headless Chromium, downloading it on first run if it's missing. */
export async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Executable doesn't exist|playwright install/i.test(message)) throw error;
    process.stderr.write('First run: downloading the Chromium browser used for scanning (one time)...\n');
    await installChromium();
    return chromium.launch({ headless: true });
  }
}
