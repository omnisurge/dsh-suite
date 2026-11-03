// The Suite's own export of the web-search module it carries. The Suite is the only profile-level
// package, so the inserted row loads this subpath: the official installer refuses insert-only
// packages (`not-bundle`), and Node resolution never enters a nested node_modules.
export * from './search/index.js';
