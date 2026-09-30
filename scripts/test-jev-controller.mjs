import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'spectre-controller-'));
try {const outfile=join(dir,'test.mjs');await build({entryPoints:['scripts/tests/jev-controller.ts'],bundle:true,platform:'node',format:'esm',outfile});await import(pathToFileURL(outfile).href);}finally{await rm(dir,{recursive:true,force:true});}
