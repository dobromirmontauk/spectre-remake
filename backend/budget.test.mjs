import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Budget, RESERVATION_USD } from './budget.mjs';
function fixture(fn) { const dir=mkdtempSync(join(tmpdir(),'jev-test-')); try { fn(join(dir,'ledger.json')); } finally { rmSync(dir,{recursive:true,force:true}); } }
test('reserve before call, preserve unknown timeout cost across restart',()=>fixture(file=>{ let b=new Budget(file); const r=b.reserve(); assert.equal(b.spentUsd,RESERVATION_USD); b.close(); b=new Budget(file); assert.equal(b.spentUsd,RESERVATION_USD); b.close(); }));
test('exclusive lock rejects concurrent server without losing ledger',()=>fixture(file=>{const b=new Budget(file);assert.throws(()=>new Budget(file),/locked/);b.close();const next=new Budget(file);next.close();}));
test('hard stop includes pending reservations and cannot be raised beyond 9.50',()=>fixture(file=>{const b=new Budget(file,{limitUsd:RESERVATION_USD*2});b.reserve();b.reserve();assert.throws(()=>b.reserve(),/budget/);assert.ok(b.spentUsd<=9.5);b.close();assert.throws(()=>new Budget(file,{limitUsd:11}),/limit/);}));
test('valid usage refunds only its own reservation, invalid usage retains full cost',()=>fixture(file=>{const b=new Budget(file);const a=b.reserve(),c=b.reserve();b.settle(a,1000);assert.equal(b.spentUsd,RESERVATION_USD+0.000042);assert.throws(()=>b.settle(c,65537),/usage/);assert.equal(b.spentUsd,RESERVATION_USD+0.000042);assert.throws(()=>b.settle(a,0),/reservation/);b.close();}));
