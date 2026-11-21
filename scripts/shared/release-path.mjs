/**
 * The one parser for a release manifest's package path.
 *
 * A frozen artifact manifest lives beside its archives: path is a basename relative to that manifest.
 * The repository pointer (artifacts/manifest.json) lives at the repository root: path is repository-relative.
 * An old manifest without pathBase keeps the historical repo-root meaning.
 */
import {dirname,isAbsolute,join,resolve} from 'node:path';

export const PATH_BASE={REPO_ROOT:'repo-root',MANIFEST_DIRECTORY:'manifest-directory'};

export function resolveManifestPackagePath({manifestPath,root,item}){
 if(!item||typeof item!=='object')throw Error('RELEASE_PATH_INVALID: package entry missing');
 if(typeof item.path==='string'&&isAbsolute(item.path))throw Error('RELEASE_PATH_ABSOLUTE: '+item.path);
 if(typeof item.filename==='string'&&isAbsolute(item.filename))throw Error('RELEASE_PATH_ABSOLUTE: '+item.filename);
 const base=item.pathBase??PATH_BASE.REPO_ROOT;
 if(base===PATH_BASE.MANIFEST_DIRECTORY){
  const rel=item.path??item.filename;
  if(typeof rel!=='string'||rel.length===0||isAbsolute(rel)||rel.includes('..'))throw Error('RELEASE_PATH_INVALID: '+String(rel));
  return resolve(dirname(manifestPath),rel);
 }
 if(base===PATH_BASE.REPO_ROOT){
  const rel=item.path??join('artifacts',item.filename??'');
  if(typeof rel!=='string'||rel.length===0||isAbsolute(rel)||rel.includes('..'))throw Error('RELEASE_PATH_INVALID: '+String(rel));
  return resolve(root,rel);
 }
 throw Error('RELEASE_PATH_BASE_INVALID: '+String(base));
}
