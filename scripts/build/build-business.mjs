import {generateManagement} from './build-management-remote.mjs';
import {assertControlledStaging} from '../shared/build-target-core.mjs';
import {buildManagementClient} from './build-management-client.mjs';
import {fileURLToPath} from 'node:url';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=fileURLToPath(new URL('../../', import.meta.url));
if(process.argv.length!==3)throw Error('STAGING_REQUIRED: build-business requires exactly one explicit owned staging directory');
const output=await assertControlledStaging(root,process.argv[2]);
await generateManagement(root,output,'web-search-searxng');
await buildManagementClient(root,output,'web-search-searxng');
const manifest=JSON.parse(await readFile(join(root,'packages/suite/package.json'),'utf8'));
const setup=join(output,'setup.js'),code=await readFile(setup,'utf8');
if(code.split('__OMNISURGE_PACKAGE_VERSION__').length!==2)throw Error('Expected one compiled setup version stamp');
// Every compiled Host file that declares the package version is stamped with the same manifest value;
// an unstamped placeholder would be reported as an unknown loaded version instead of a version.
let stamped=0;
for(const name of (await readdir(output)).filter(name=>name.endsWith('.js'))){
 const file=join(output,name),text=await readFile(file,'utf8'),occurrences=text.split('__OMNISURGE_PACKAGE_VERSION__').length-1;
 if(occurrences===0)continue;
 if(occurrences!==1)throw Error('Expected one compiled package version stamp in '+name);
 await writeFile(file,text.replace('__OMNISURGE_PACKAGE_VERSION__',manifest.version));stamped+=1;
}
if(stamped<2)throw Error('Expected the compiled setup and Host entry version stamps, found '+stamped);
