import { openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, fsyncSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
export const RATE_USD = 0.042 / 1_000_000;
export const MAX_INPUT_TOKENS = 65536;
export const RESERVATION_USD = MAX_INPUT_TOKENS * RATE_USD;
const MAX_LIMIT_USD = 9.50;
/** Lock is intentionally never auto-stolen: crashed processes need manual PID verification. */
export class Budget {
 constructor(file,{limitUsd=MAX_LIMIT_USD}={}) {
  if (!isAbsolute(file)) throw new Error('ledger path must be absolute');
  if (!Number.isFinite(limitUsd)||limitUsd<=0||limitUsd>MAX_LIMIT_USD) throw new Error('invalid budget limit');
  this.file=file;this.limitUsd=limitUsd;this.pending=new Map();this.lock=file+'.lock';mkdirSync(dirname(file),{recursive:true});
  try {this.fd=openSync(this.lock,'wx',0o600);writeFileSync(this.fd,JSON.stringify({pid:process.pid}));fsyncSync(this.fd);} catch {throw new Error('budget ledger locked; verify prior server stopped before removing lock');}
  try {
   try { this.data=JSON.parse(readFileSync(file,'utf8')); } catch(e) { if(e.code!=='ENOENT')throw e;this.data={version:1,spentUsd:0,calls:0}; }
   if(this.data.version!==1||!Number.isFinite(this.data.spentUsd)||this.data.spentUsd<0||!Number.isSafeInteger(this.data.calls)||this.data.calls<0)throw new Error('invalid budget ledger');
   this.save();
  } catch(e){this.close();throw e;}
 }
 get spentUsd(){return this.data.spentUsd;}
 save(){const temp=this.file+'.tmp';const fd=openSync(temp,'w',0o600);try{writeFileSync(fd,JSON.stringify(this.data)+'\n');fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,this.file);const dir=openSync(dirname(this.file),'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
 reserve(){if(this.closed)throw new Error('budget closed');if(this.spentUsd+RESERVATION_USD>this.limitUsd+1e-12)throw new Error('budget exhausted');const id=randomUUID();this.data.spentUsd+=RESERVATION_USD;this.data.calls++;this.save();this.pending.set(id,RESERVATION_USD);return id;}
 settle(id,inputTokens){if(!this.pending.has(id))throw new Error('unknown reservation');if(!Number.isSafeInteger(inputTokens)||inputTokens<0||inputTokens>MAX_INPUT_TOKENS)throw new Error('invalid upstream usage');this.data.spentUsd=Math.max(0,this.spentUsd-this.pending.get(id)+inputTokens*RATE_USD);this.save();this.pending.delete(id);return inputTokens*RATE_USD;}
 close(){if(this.closed)return;this.closed=true;if(this.fd!==undefined){closeSync(this.fd);unlinkSync(this.lock);}}
}
