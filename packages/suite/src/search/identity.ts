/**
 * This module's identity, in one place. The row id is what the official plugin manager reports in
 * `BundleInfo.rows[].rowId`, so it is also the only input that decides which bundle owns this settings
 * entry. The owner is the Suite package: the Suite's own patch declares the row, and the module it
 * inserts is a Subpath of that same package, so no second installable unit can own the row.
 */
export const OWNER_PACKAGE = '@omnisurge/dsh-suite';
export const PLUGIN_MODULE = '@omnisurge/dsh-suite/searxng';
export const PLUGIN_ROW = 'omnisurge-web-search-searxng';
