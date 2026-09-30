import assert from 'node:assert/strict';
import {JevSession} from '../src/game/jev-session.ts';
import {createInitialState} from '../src/sim/simulation.ts';
import {DEFAULT_LOADOUT} from '../src/config/constants.ts';
const state=createInitialState(3,[{loadout:DEFAULT_LOADOUT}]);state.enemies.splice(1);state.obstacles=[];const enemy=state.enemies[0]!;enemy.position={x:0,z:0};enemy.prevPosition={...enemy.position};enemy.heading=0;enemy.speed=0;state.players[0]!.position={x:80,z:80};
const mock:typeof fetch=async(_input,init)=>{const b=JSON.parse(String(init?.body));return new Response(JSON.stringify({sequence:b.sequence,tick:b.tick,decisions:b.tanks.map((t:{tankId:string;candidates:{id:string}[]})=>({tankId:t.tankId,choice:t.candidates[0]!.id}))}));};
const session=new JevSession(mock,()=>0.7);session.configure({enabled:true});session.update(state,0,true,true,true);await new Promise(r=>setTimeout(r,0));assert.equal(session.getStats().modelDecisions,1);
for(let tick=31;tick<=36;tick++){state.tick=tick;assert.deepEqual(session.command(state,enemy),{turn:0,thrust:0,fire:false,grenade:false},'expired accepted plan preserves neutral aim within6ticks');}
state.tick=37;assert.deepEqual(session.command(state,enemy),{turn:1,thrust:0,fire:false,grenade:false});assert.equal(session.getStats().fallbackTicks,7);assert.equal(session.getStats().modelCommandTicks,0);assert.deepEqual(session.getStats().appliedChoiceHistogram,{});const record=session.getDecisionLog()[0]!;assert.equal(record.decisions[0]!.applied,false);assert.equal(record.decisions[0]!.notAppliedReason,'expired');session.configure({enabled:false});console.log('Actual session passes expired accepted plan only for local6tick neutral grace, then scan; fallback accounting and no applied model claims');
