// PR #165の生成器を固定し、通常・ライバルの完全一致と改善前後を再現する。
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, 'friendly-rounds-before-balance.ts.txt'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const baseline = { exports: {} };
new Function('require', 'exports', code)(specifier => {
  if (specifier === './friendly-match-results') return require('../../lib/friendly-match-results.ts');
  throw new Error(`未対応の比較用import: ${specifier}`);
}, baseline.exports);
module.exports = baseline.exports;
// 評価比率だけを同じ80:20にした対照実験。凍結ファイル・候補生成・枝刈り・重みは変更しない。
const withStrengths = { exports: {} };
const comparisonSource = source.replace('const form = friendlyFormScores(eventId, history, known);', 'const form = params.comparisonForm ?? friendlyFormScores(eventId, history, known);');
const comparisonCode = ts.transpileModule(comparisonSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
new Function('require','exports',comparisonCode)(() => require('../../lib/friendly-match-results.ts'), withStrengths.exports);
module.exports.generateWithStrengths = withStrengths.exports.generateFriendlyRound;
