/** Pure affected-path → development-gate plan. No filesystem or process access, so this mapping is testable.
 *
 * This is deliberately a development-loop aid: it never replaces the full release `pnpm run check`,
 * which still includes pack/package/composition/client-mutations/G5 and the final evidence binding.
 */
import {GROUP} from './source-groups.mjs';

export const AFFECTED_CHECKS = {
  build: { label: 'build', command: ['pnpm', 'build'] },
  'check:docs': { label: 'check:docs', command: ['pnpm', 'run', 'check:docs'] },
  'check:target': { label: 'check:target', command: ['pnpm', 'run', 'check:target'] },
  'check:layering': { label: 'check:layering', command: ['pnpm', 'run', 'check:layering'] },
  'check:client-ui': { label: 'check:client-ui', command: ['pnpm', 'run', 'check:client-ui'] },
  'check:copy': { label: 'check:copy', command: ['pnpm', 'run', 'check:copy'] },
  'check:ocr-card': { label: 'check:ocr-card', command: ['pnpm', 'run', 'check:ocr-card'] },
  'check:official-model-selection': { label: 'check:official-model-selection', command: ['pnpm', 'run', 'check:official-model-selection'] },
  'test:unit': { label: 'test:unit', command: ['pnpm', 'test'] },
  'test:development': { label: 'test:development', command: ['pnpm', 'run', 'test:development'] },
  'test:package': { label: 'test:package', command: ['pnpm', 'run', 'test:package'] },
  'test:package:temp': { label: 'test:package:temp', command: ['pnpm', 'run', 'test:package'] },
  'test:ui': { label: 'test:ui', command: ['pnpm', '--filter', '@omnisurge/dsh-ui', 'test'] },
  'test:compaction-budget': { label: 'test:compaction-budget', command: ['node', '--test', 'test/compaction-budget.test.mjs', 'test/compaction-budget-hook.test.mjs'] },
  'test:compaction-guard': { label: 'test:compaction-guard', command: ['node', '--test', 'test/compaction-guard.test.mjs', 'test/compaction-guard-fixture.test.mjs'] },
  'test:team-mode': { label: 'test:team-mode', command: ['node', '--test', 'test/team-mode.test.mjs', 'test-development/manager-lifecycle.test.mjs'] },
  'test:effort-slider': { label: 'test:effort-slider', command: ['node', '--test', 'test-development/effort-slider.test.mjs'] },
  'test:affected': { label: 'test:affected', command: ['node', '--test', 'test-development/affected-gate.test.mjs'] },
  'check:storybook-coverage': { label: 'check:storybook-coverage', command: ['pnpm', 'run', 'check:storybook-coverage'] },
};

/** Checks that read build output rather than building it themselves. `test:unit` is `pnpm test`,
 * which builds internally, so a plan with only test:unit and non-build consumers does not need a
 * standalone build. A build-dependent check keeps an explicit build even when test:unit is selected,
 * because otherwise a consumer such as check:ocr-card could run before the build that produces
 * packages/suite/lib/client.js. The returned plan always moves build to the front. */
const BUILD_DEPENDENT_CHECKS = new Set([
  'check:ocr-card',
  'test:compaction-budget',
  'test:compaction-guard',
  'test:team-mode',
  'test:effort-slider',
  'test:ui',
  'test:development',
  'test:package:temp',
]);

/** Every file the single source-group table calls `client`. The table is the only authority, so new
 * Client files are covered without editing this planner again. */
const CLIENT_FILES = Object.entries(GROUP)
  .filter(([, group]) => group === 'client')
  .map(([file]) => file);
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const CLIENT_FILE_PATTERN = new RegExp(`^packages/suite/src/(?:${CLIENT_FILES.map(escapeRegExp).join('|')})$`, 'u');

const rules = [
  { pattern: /^packages\/suite\/src\/compaction-budget(?:-core|-provenance)?\.ts$/, checks: ['test:compaction-budget', 'check:layering'] },
  { pattern: /^(?:AGENTS|README)\.md$/, checks: ['check:docs', 'check:target'] },
  { pattern: /^docs\//, checks: ['check:docs', 'check:target'] },
  { pattern: /^packages\/suite\/src\/compaction-guard\.ts$/, checks: ['test:compaction-guard', 'check:layering'] },
  { pattern: /^packages\/suite\/src\/host\.ts$/, checks: ['test:unit', 'check:layering', 'test:development'] },
  // OCR card: the built packages/suite/lib/client.js must exist before check:ocr-card reads it.
  { pattern: /^packages\/suite\/src\/ocr\/client\.js$/, checks: ['build', 'check:ocr-card', 'check:copy', 'check:client-ui', 'test:unit', 'check:layering'] },
  // The effort slider is an explicit Client product skin: its own focused suite plus the shared gates.
  { pattern: /^packages\/suite\/src\/effort-slider\/client\//, checks: ['check:client-ui', 'check:copy', 'test:effort-slider'] },
  // All remaining Client-group files (main Client, search, tools, teams, document-parse,
  // compaction-budget, failure/readiness helpers) get the vocabulary and copy gates.
  { pattern: CLIENT_FILE_PATTERN, checks: ['check:client-ui', 'check:copy', 'test:unit', 'check:layering'] },
  { pattern: /^packages\/suite\/src\/team-mode\.ts$|^packages\/suite\/src\/teams\//, checks: ['test:team-mode'] },
  { pattern: /^packages\/suite\/src\//, checks: ['test:unit', 'check:layering'] },
  { pattern: /^packages\/ui\//, checks: ['test:ui', 'check:client-ui'] },
  { pattern: /^packages\/ui-storybook\//, checks: ['check:storybook-coverage'] },
  { pattern: /^scripts\/gates\/official-|^scripts\/gates\/verify-candidate-gui/, checks: ['check:official-model-selection'] },
  { pattern: /^scripts\/build\//, checks: ['build', 'test:development'] },
  { pattern: /^scripts\/tools\/extract-copy\.mjs$/, checks: ['check:copy', 'build', 'test:development'] },
  { pattern: /^scripts\/tools\/(?:check-target|write-target-contract)\.mjs$/, checks: ['check:target', 'test:development'] },
  { pattern: /^scripts\/tools\//, checks: ['test:development'] },
  { pattern: /^scripts\/(gates|shared|release)\//, checks: ['test:development'] },
  { pattern: /^test-development\//, checks: ['test:development'] },
  { pattern: /^test-package\//, checks: ['test:package:temp'] },
  { pattern: /^test\//, checks: ['test:unit'] },
  { pattern: /^packages\/suite\/(components\.json|cordis\.patch\.yml|package\.json)$/, checks: ['check:target', 'build', 'test:package:temp'] },
  { pattern: /^(package\.json|pnpm-lock\.yaml)$/, checks: ['test:unit'] },
];

/** Return the ordered, de-duplicated checks for a set of changed paths. */
export function planFor(files) {
  const paths = [...new Set((files ?? []).map(path => String(path).replace(/^\.\//, '').replace(/\\/g, '/')).filter(Boolean))];
  const selected = new Set();
  const reasons = [];
  for (const path of paths) {
    for (const rule of rules) {
      if (!rule.pattern.test(path)) continue;
      for (const check of rule.checks) selected.add(check);
      reasons.push({ path, checks: [...rule.checks] });
      break;
    }
  }
  // A targeted source check needs the build output. `test:unit` is `pnpm test`, which builds
  // internally, so it can satisfy a sibling `test:development` as long as it runs first; every other
  // build-dependent check keeps an explicit build even when test:unit is selected.
  const buildDependents = [...selected].filter(check => BUILD_DEPENDENT_CHECKS.has(check));
  const testUnitBuilds = selected.has('test:unit') && buildDependents.every(check => check === 'test:development');
  const requiresBuild = buildDependents.length > 0 && !testUnitBuilds;
  if (requiresBuild) selected.add('build');
  if (selected.has('test:unit') && !requiresBuild) selected.delete('build');
  // The build must precede every consumer, regardless of rule ordering.
  const checks = [...selected];
  if (checks.includes('build')) {
    checks.splice(checks.indexOf('build'), 1);
    checks.unshift('build');
  }
  return { paths, checks, reasons };
}
