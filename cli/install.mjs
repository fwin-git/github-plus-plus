#!/usr/bin/env node
// Guided/automated extension install:
//   npm run install-ext                  interactive
//   npm run install-ext -- --list        show detected browsers
//   npm run install-ext -- --browser firefox --trial
//   npm run install-ext -- --dry-run     print what would run, run nothing
//
// No browser offers a deep link that installs an unpacked extension (by
// design). This CLI automates everything else: builds dist/, opens the right
// extensions page, preloads your clipboard with the path, and for trials
// launches a session with the extension already loaded.
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { detectBrowsers } from './browsers.js';
import { buildPlan } from './plan.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distPath = join(root, 'dist');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => {
  const i = args.indexOf(f);
  return i !== -1 ? args[i + 1] : null;
};

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

if (has('--help') || has('-h')) {
  console.log(`Github++ installer

Usage: node cli/install.mjs [options]

  --browser <id>   chrome | brave | edge | chromium | firefox
  --trial          launch a throwaway session with the extension pre-loaded
  --list           list detected browsers and exit
  --dry-run        print the launch plan without executing anything
  --help           this text
`);
  process.exit(0);
}

function copyToClipboard(text) {
  const attempts =
    process.platform === 'darwin'
      ? [['pbcopy', []]]
      : process.platform === 'win32'
        ? [['clip', []]]
        : [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['-ib']],
          ];
  for (const [cmd, cmdArgs] of attempts) {
    try {
      const r = spawnSync(cmd, cmdArgs, { input: text });
      if (r.status === 0) return true;
    } catch {
      // try next tool
    }
  }
  return false;
}

async function main() {
  // 1. Make sure dist/ exists.
  if (!existsSync(join(distPath, 'manifest.json'))) {
    console.log(dim('dist/ not built yet — running build…'));
    const r = spawnSync(process.execPath, [join(root, 'build.mjs')], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('Build failed — cannot continue.');
      process.exit(1);
    }
  }

  // 2. Detect browsers.
  const detected = detectBrowsers(process.platform, existsSync, process.env);
  if (has('--list')) {
    if (!detected.length) console.log('No supported browsers detected.');
    for (const b of detected) console.log(`${b.id.padEnd(9)} ${b.name}  ${dim(b.bin)}`);
    return;
  }
  if (!detected.length) {
    console.log(`No supported browser found automatically. Manual install:
  Chrome-family: open chrome://extensions, enable Developer mode, "Load unpacked" → ${distPath}
  Firefox:       open about:debugging#/runtime/this-firefox, "Load Temporary Add-on…" → ${distPath}/manifest.json`);
    process.exit(1);
  }

  // 3. Pick browser + mode.
  let browser = detected.find((b) => b.id === valueOf('--browser'));
  let mode = has('--trial') ? 'trial' : valueOf('--browser') ? 'guided' : null;
  if (!browser || mode === null) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!browser) {
      console.log(bold('\nWhich browser?'));
      detected.forEach((b, i) => console.log(`  ${i + 1}. ${b.name} ${dim(b.bin)}`));
      const answer = await rl.question(`Choose 1-${detected.length} [1]: `);
      browser = detected[(parseInt(answer, 10) || 1) - 1] ?? detected[0];
    }
    if (mode === null) {
      console.log(bold('\nInstall how?'));
      console.log(`  1. Guided install ${dim('— opens the extensions page, you finish with 2-3 clicks; persists in Chromium browsers')}`);
      console.log(`  2. Quick trial    ${dim('— launches a throwaway session with the extension already loaded, zero clicks')}`);
      const answer = await rl.question('Choose 1-2 [1]: ');
      mode = answer.trim() === '2' ? 'trial' : 'guided';
    }
    rl.close();
  }

  // 4. Build and execute the plan.
  const tmpDir = mode === 'trial' ? await mkdtemp(join(tmpdir(), 'gdt-trial-')) : null;
  const plan = buildPlan(browser, { distPath, mode, tmpDir, platform: process.platform });

  if (has('--dry-run')) {
    console.log(bold(`\nPlan for ${browser.name} (${mode}):`));
    if (plan.kind === 'spawn') console.log(`  launch: ${plan.bin} ${plan.args.join(' ')}`);
    else console.log(`  launch: npx --yes web-ext ${plan.args.join(' ')}`);
    if (plan.clipboard) console.log(`  clipboard: ${plan.clipboard}`);
    plan.steps.forEach((s, i) => console.log(`  step ${i + 1}: ${s}`));
    if (plan.note) console.log(`  note: ${plan.note}`);
    return;
  }

  if (plan.clipboard) {
    const copied = copyToClipboard(plan.clipboard);
    console.log(copied ? green(`\n✓ Copied to clipboard: ${plan.clipboard}`) : `\nPath you will need: ${bold(plan.clipboard)}`);
  }

  console.log(bold(`\n${mode === 'trial' ? 'Launching trial session' : 'Opening'} ${browser.name}…\n`));
  plan.steps.forEach((s, i) => console.log(`  ${bold(String(i + 1) + '.')} ${s}`));
  if (plan.note) console.log(yellow(`\n  Note: ${plan.note}`));
  console.log('');

  if (plan.kind === 'webext') {
    const r = spawnSync('npx', ['--yes', 'web-ext', ...plan.args], {
      stdio: 'inherit',
      cwd: root,
      shell: process.platform === 'win32',
    });
    process.exit(r.status ?? 0);
  } else {
    const child = spawn(plan.bin, plan.args, { detached: true, stdio: 'ignore' });
    child.on('error', (err) => {
      console.error(`Could not launch ${browser.name}: ${err.message}`);
      process.exit(1);
    });
    child.unref();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
