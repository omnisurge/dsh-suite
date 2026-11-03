import { mkdir, realpath, lstat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname, sep } from 'node:path';
/** Resolve existing ancestors before writes: an ignored-directory alias must not redirect into production. */
export async function developmentStatePath(repository, requested) { const scratch = join(resolve(repository), '.scratch'), state = resolve(requested), rel = relative(scratch, state); if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
    throw Error('Development state must be a dedicated child of repository .scratch'); await mkdir(scratch, { recursive: true }); if ((await lstat(scratch)).isSymbolicLink())
    throw Error('Repository .scratch must not redirect through a symlink'); const root = await realpath(scratch); let parent = state; for (;;) {
    let actual;
    try {
        actual = await realpath(parent);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
        parent = dirname(parent);
        continue;
    }
    if (actual !== root && !actual.startsWith(root + sep))
        throw Error('Development state alias escapes repository .scratch');
    break;
} return state; }
