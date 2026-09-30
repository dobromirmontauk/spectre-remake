import assert from 'node:assert/strict';
import {drawPersonality,PersonalityAssignments} from '../src/jev/personality.ts';
const counts={aggressive:0,neutral:0,cowardly:0};for(let i=0;i<1000;i++)counts[drawPersonality(()=>i/1000)]++;assert.deepEqual(counts,{aggressive:600,neutral:200,cowardly:200});
assert.equal(drawPersonality(()=>0.599999),'aggressive');assert.equal(drawPersonality(()=>0.6),'neutral');assert.equal(drawPersonality(()=>0.8),'cowardly');assert.throws(()=>drawPersonality(()=>1));
const draws=[0.1,0.9,0.7];let index=0;const assignments=new PersonalityAssignments(()=>draws[index++]!);assert.equal(assignments.get('e1'),'aggressive');assert.equal(assignments.get('e1'),'aggressive');assert.equal(assignments.get('player',true),'neutral');assert.equal(index,1);assignments.forget('e1');assert.equal(assignments.get('e1'),'cowardly');assignments.reset();assert.equal(assignments.get('e1'),'neutral');assert.equal(index,3);
console.log('Personality distribution and life/level assignment fixtures pass');

import { JevSession } from '../src/game/jev-session.ts';
import { createInitialState } from '../src/sim/simulation.ts';
import { DEFAULT_LOADOUT } from '../src/config/constants.ts';
const fetcher:typeof fetch=async(_input,init)=>{const b=JSON.parse(String(init?.body));return new Response(JSON.stringify({sequence:b.sequence,tick:b.tick,decisions:b.tanks.map((t:{tankId:string;candidates:{id:string}[]})=>({tankId:t.tankId,choice:t.candidates[0]!.id})),usage:{inputTokens:0},spentUsd:0}));};
const sequence=[0.1,0.7,0.9,0.9,0.7,0.1,0.1];let draw=0;
const session=new JevSession(fetcher,()=>sequence[draw++%sequence.length]!);const state=createInitialState(5,[{loadout:DEFAULT_LOADOUT}]);const rngBefore=JSON.stringify(state.rng);
const flush=()=>new Promise(r=>setTimeout(r,0));session.configure({enabled:true,playerAutopilot:true,hz:2});session.update(state,0,true,true,true);await flush();const enemy=state.enemies[0]!.id;assert.equal(session.getObservation(enemy)?.own.personality,'aggressive');assert.equal(session.getObservation(state.players[0]!.id)?.own.personality,'neutral');assert.equal(draw,3);assert.equal(JSON.stringify(state.rng),rngBefore);
state.tick=1;session.update(state,100,false,true,true);session.configure({enabled:true,hz:5});state.tick=2;session.update(state,600,true,true,true);await flush();assert.equal(session.getObservation(enemy)?.own.personality,'aggressive');assert.equal(draw,3);
state.events=[{type:'EnemyDestroyed',enemyId:enemy,position:{...state.enemies[0]!.position}},{type:'EnemyRespawned',enemyId:enemy,position:{...state.enemies[0]!.position}}];session.recordTick(state);state.events=[];state.tick=3;session.update(state,1200,true,true,true);await flush();assert.equal(session.getObservation(enemy)?.own.personality,'cowardly');assert.equal(draw,4);
state.level=6;state.tick=4;session.update(state,1800,true,true,true);await flush();assert.equal(session.getObservation(enemy)?.own.personality,'neutral');assert.equal(draw,7);session.configure({enabled:false});console.log('Session preserves personalities across pause/config, redraws life/level, and keeps player neutral without touching sim RNG');
