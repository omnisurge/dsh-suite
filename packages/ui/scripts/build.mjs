/**
 * Build for the migrated `@omnisurge/dsh-ui` library.
 *
 * The upstream shell built this package with `tsdown` and emitted declarations. In this repository the
 * library is a build-time library consumed only by Client bundles, which are themselves bundled by the
 * Suite's own esbuild step; React must stay external (ADR-028 single-React), so the port keeps that
 * contract and drops only the packaging tool and the declaration output that nothing here consumes.
 */
import {build} from 'esbuild';

const shared = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
};

await build({...shared, entryPoints: ['src/index.ts', 'src/intercept-method.ts'], outdir: 'lib', outExtension: {'.js': '.js'}});
