import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'spectre-controller-'));
try {for(const [i,entry]of ['scripts/tests/jev-controller.ts','scripts/tests/jev-tactics-v2.ts','scripts/tests/jev-motion-regressions.ts','scripts/tests/jev-shared-combat.ts','scripts/tests/jev-crowding.ts','scripts/tests/jev-hold-expiry.ts'].entries()){const outfile=join(dir,'test'+i+'.mjs');await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile});await import(pathToFileURL(outfile).href);}}finally{await rm(dir,{recursive:true,force:true});}
