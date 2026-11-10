// Build: bundles ESM sources into MV3-ready flat files in dist/.
//   node build.mjs           one-shot build
//   node build.mjs --watch   rebuild on change
//   node build.mjs --zip     build + store zips in artifacts/
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const watch = process.argv.includes('--watch');
const zip = process.argv.includes('--zip');
const root = new URL('.', import.meta.url).pathname;
const dist = join(root, 'dist');

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const buildOptions = {
  entryPoints: [
    { in: 'src/content/index.js', out: 'content' },
    { in: 'src/options/options.js', out: 'options' },
    { in: 'src/popup/popup.js', out: 'popup' },
  ],
  bundle: true,
  format: 'iife',
  target: ['chrome121', 'firefox121'],
  outdir: 'dist',
  logLevel: 'info',
  legalComments: 'none',
  minify: false,
  sourcemap: false,
};

function copyStatic() {
  cpSync(join(root, 'manifest.json'), join(dist, 'manifest.json'));
  cpSync(join(root, 'src/content/viewer.css'), join(dist, 'content.css'));
  for (const page of ['options', 'popup']) {
    cpSync(join(root, `src/${page}/${page}.html`), join(dist, `${page}.html`));
    cpSync(join(root, `src/${page}/${page}.css`), join(dist, `${page}.css`));
  }
  mkdirSync(join(dist, 'icons'), { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const icon = join(root, `icons/icon${size}.png`);
    if (!existsSync(icon)) {
      console.error(`missing ${icon} — run: npm run icons`);
      process.exit(1);
    }
    cpSync(icon, join(dist, `icons/icon${size}.png`));
  }
}

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  copyStatic();
  await ctx.watch();
  console.log('watching… (static files copied once; rerun on manifest/css/html changes)');
} else {
  await esbuild.build(buildOptions);
  copyStatic();
  console.log('built dist/');
  if (zip) {
    const artifacts = join(root, 'artifacts');
    mkdirSync(artifacts, { recursive: true });
    for (const browser of ['chrome', 'firefox']) {
      const out = join(artifacts, `github-plus-plus-${browser}-v${manifest.version}.zip`);
      rmSync(out, { force: true });
      execFileSync('zip', ['-r', '-q', out, '.'], { cwd: dist });
      console.log(`wrote ${out}`);
    }
  }
}
