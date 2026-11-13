# Omnisurge DSH Suite

Independent extensions for DeepSeek Harness. This is a curated source export, not the private development repository or an official DSH distribution.

License: MIT.

## Build

Use Node.js 24 and the pnpm version declared in package.json. Run `pnpm install --frozen-lockfile`, then `pnpm run build`. The export carries build inputs; private tests, internal documentation, release automation and credentials are not included.

The workspace root is a private workspace manifest at version 0.0.0; the release package version is declared in `packages/suite/package.json`. A few legacy runtime identifiers retain their original namespace so existing authorizations keep their identity; they are not repository links.

Building is not installation or publication. Runtime compatibility is declared by the package manifests; this export does not claim additional platform or GUI validation.
