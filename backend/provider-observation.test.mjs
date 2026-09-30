import test from 'node:test';
import assert from 'node:assert/strict';
import {providerRequest} from './server.mjs';
import {providerObservation,canonicalHeading} from './provider-observation.mjs';
test('provider headings canonicalized without mutating perception or restoring hidden data',()=>{
 const o={level:2,own:{position:{x:10,z:20},heading:12.13},contacts:[{id:'visible',kind:'tank',heading:-.2,position:{x:12.3,z:9.4}}],memory:[{id:'dated',kind:'tank',heading:8,seenSeconds:1,ageSeconds:3,position:{x:5,z:6}}],geometry:[{kind:'windmill',bladeAngle:9}]};
 const before=structuredClone(o);const p=providerObservation(o);assert.deepEqual(o,before);assert.deepEqual(p.own.position,o.own.position);assert.deepEqual(p.memory[0].position,o.memory[0].position);assert.equal(p.memory[0].ageSeconds,3);assert.equal(p.geometry[0].bladeAngle,9);
 for(const h of [p.own.heading,p.contacts[0].heading,p.memory[0].heading])assert(h>=0&&h<2*Math.PI);
 assert(Math.abs(Math.sin(p.own.heading)-Math.sin(o.own.heading))<1e-12);assert.equal(canonicalHeading(0),0);assert.equal(canonicalHeading(2*Math.PI),0);
});
test('provider instructions state exact conventions and bounded safety honestly',()=>{
 const p=providerRequest({tanks:[{tankId:'enemy',role:'enemy',observation:{own:{heading:12.13}},candidates:[{id:'move',description:'Known clear route'}]}]});const text=p.questions.tank_0.instructions;
 assert.match(text,/atan2\(delta x, delta z\)/);assert.match(text,/rounded to the nearest 10/);assert.match(text,/observed tank positions remain precise/);assert.match(text,/30 ticks\/second/);assert.match(text,/not guaranteed outcomes/);assert.match(text,/never invent unavailable/);assert(!text.includes('validated local outcomes'));assert.deepEqual(Object.keys(p.state.observations),['enemy']);
});
