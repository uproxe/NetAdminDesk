// Ad-hoc подпись приложения macOS (без сертификата Apple Developer).
// На Apple Silicon неподписанный код не запускается вовсе («приложение повреждено»),
// поэтому после упаковки выполняется `codesign --sign -`. Это НЕ подпись разработчика
// и НЕ нотаризация: Gatekeeper при первом запуске всё равно покажет предупреждение.
// Хук afterSign выполняется один раз — для итогового универсального приложения
// (подпись промежуточных x64/arm64 сборок помешала бы их объединению).
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc подпись ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
};
