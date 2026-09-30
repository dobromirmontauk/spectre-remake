import {openSync,closeSync,writeSync,readSync,fstatSync,fsyncSync,unlinkSync,mkdirSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
/** Append-only, fsynced local evidence. Corrupt/unwritable history fails closed. */
export class Audit {
 constructor(file){
  if(!isAbsolute(file))throw new Error('audit path must be absolute');
  this.file=file;this.lock=file+'.lock';this.index=[];this.bytes=0;this.healthy=true;mkdirSync(dirname(file),{recursive:true});
  try{this.lockFd=openSync(this.lock,'wx',0o600);writeSync(this.lockFd,JSON.stringify({pid:process.pid}));fsyncSync(this.lockFd);}catch{throw new Error('audit locked');}
  try{
   this.fd=openSync(file,'a+',0o600);const dir=openSync(dirname(file),'r');try{fsyncSync(dir);}finally{closeSync(dir);}
   // Retain byte offsets, not full perception payloads. Scan restart history in bounded chunks.
   const pending=new Map(),size=fstatSync(this.fd).size;let carry=Buffer.alloc(0),position=0,lineOffset=0;const chunk=Buffer.alloc(65536);
   while(position<size){const n=readSync(this.fd,chunk,0,Math.min(chunk.length,size-position),position);if(!n)throw new Error('audit read failed');position+=n;carry=Buffer.concat([carry,chunk.subarray(0,n)]);let newline;
    while((newline=carry.indexOf(10))>=0){const length=newline+1;const record=JSON.parse(carry.subarray(0,newline).toString('utf8'));if(!record.recordId||!record.timestamp||!record.type)throw new Error('invalid audit');this.index.push({offset:lineOffset,length});lineOffset+=length;carry=carry.subarray(length);if(record.type==='request')pending.set(record.callId,{tankId:record.tankId,sequence:record.sequence,tick:record.tick,reservedCostUsd:record.reservedCostUsd});else if(['result','error','interrupted'].includes(record.type))pending.delete(record.callId);}
    if(carry.length>131072)throw new Error('audit record too large');
   }
   if(carry.length)throw new Error('incomplete audit file');this.bytes=size;
   for(const [callId,r] of pending)this.append({type:'interrupted',callId,tankId:r.tankId,sequence:r.sequence,tick:r.tick,costUsd:r.reservedCostUsd,error:'prior server stopped before completion; reservation retained'});
  }catch(e){this.close();throw e;}
 }
 append(fields){if(!this.healthy||this.closed)throw new Error('audit unavailable');const record={...fields,recordId:randomUUID(),timestamp:new Date().toISOString()};try{const line=Buffer.from(JSON.stringify(record)+'\n');let written=0;while(written<line.length)written+=writeSync(this.fd,line,written,line.length-written);fsyncSync(this.fd);this.index.push({offset:this.bytes,length:line.length});this.bytes+=line.length;return record;}catch{this.healthy=false;throw new Error('audit unavailable');}}
 page(offset=0,limit=50){const records=this.index.slice(offset,offset+limit).map(({offset,length})=>{const buffer=Buffer.alloc(length);let n=0;while(n<length){const read=readSync(this.fd,buffer,n,length-n,offset+n);if(!read)throw new Error('audit read failed');n+=read;}return JSON.parse(buffer.toString('utf8'));});return {records,nextOffset:offset+limit<this.index.length?offset+limit:null,total:this.index.length};}
 close(){if(this.closed)return;this.closed=true;if(this.fd!==undefined)closeSync(this.fd);if(this.lockFd!==undefined){closeSync(this.lockFd);unlinkSync(this.lock);}}
}
