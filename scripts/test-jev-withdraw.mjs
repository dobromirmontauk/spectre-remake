import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'spectre-withdraw-'));
try{const outfile=join(dir,'test.mjs');await build({entryPoints:['scripts/tests/jev-withdraw-fire.ts'],bundle:true,platform:'node',format:'esm',outfile});await import(pathToFileURL(outfile).href);}finally{await rm(dir,{recursive:true,force:true});}
