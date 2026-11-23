// Сборка NetAdmin Desk: main, preload и renderer через esbuild.
//   node scripts/build.mjs            — production-сборка в dist/
//   node scripts/build.mjs --watch    — пересборка при изменениях
//   node scripts/build.mjs --preview  — только интерфейс с имитацией API (для проверки в браузере)
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const preview = args.has('--preview');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const nodePaths = (process.env.NODE_PATH || '').split(/[:;]/).filter(Boolean);

const define = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __PREVIEW__: JSON.stringify(preview),
  'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production')
};

const outRoot = join(root, preview ? 'dist-preview' : 'dist');
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(join(outRoot, 'renderer'), { recursive: true });

/** @type {import('esbuild').BuildOptions[]} */
const builds = [];

if (!preview) {
  builds.push({
    entryPoints: [join(root, 'src/main/main.ts')],
    outfile: join(outRoot, 'main/main.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    sourcemap: true,
    // Нативные/внешние модули остаются в node_modules и упаковываются electron-builder.
    external: ['electron', 'ssh2', 'sql.js', 'cpu-features'],
    define,
    nodePaths,
    logLevel: 'info'
  });
  builds.push({
    entryPoints: [join(root, 'src/preload/preload.ts')],
    outfile: join(outRoot, 'preload/preload.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    sourcemap: true,
    external: ['electron'],
    define,
    nodePaths,
    logLevel: 'info'
  });
}

const rendererAlias = preview
  ? {
      '@xterm/xterm': join(root, 'tools/preview/xterm-stub.ts'),
      '@xterm/addon-fit': join(root, 'tools/preview/xterm-stub.ts'),
      '@xterm/addon-search': join(root, 'tools/preview/xterm-stub.ts')
    }
  : {};

builds.push({
  entryPoints: [join(root, preview ? 'tools/preview/preview-entry.tsx' : 'src/renderer/main.tsx')],
  outfile: join(outRoot, 'renderer/renderer.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  jsx: 'automatic',
  sourcemap: !preview,
  minify: !watch && !preview,
  loader: { '.woff2': 'file', '.ttf': 'file', '.svg': 'text', '.txt': 'text' },
  alias: rendererAlias,
  plugins: preview ? [stubCssPlugin()] : [],
  define,
  nodePaths,
  logLevel: 'info'
});

function stubCssPlugin() {
  return {
    name: 'stub-xterm-css',
    setup(build) {
      build.onResolve({ filter: /^@xterm\/xterm\/css\/xterm\.css$/ }, () => ({
        path: join(root, 'tools/preview/xterm-stub.css')
      }));
    }
  };
}

function copyStatic() {
  const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8');
  writeFileSync(join(outRoot, 'renderer/index.html'), html);
  if (!preview) {
    // Исходные TXT пользователя поставляются вместе с приложением для первичного импорта.
    cpSync(join(root, 'data/user'), join(outRoot, 'data/user'), { recursive: true });
    // Иконка окна и значки области уведомлений (см. scripts/make-icons.py)
    for (const f of ['icon.png', 'tray.png', 'tray@2x.png', 'trayTemplate.png', 'trayTemplate@2x.png']) {
      if (existsSync(join(root, 'build', f))) cpSync(join(root, 'build', f), join(outRoot, 'renderer', f));
    }
  }
  // Логотип для вкладки браузера в режиме просмотра
  cpSync(join(root, 'build/logo.svg'), join(outRoot, 'renderer/logo.svg'));
}

if (watch) {
  const ctxs = await Promise.all(builds.map((b) => esbuild.context(b)));
  copyStatic();
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('Наблюдение за изменениями…');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  copyStatic();
  console.log(`Сборка завершена: ${outRoot}`);
}
