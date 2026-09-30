export type Personality = 'aggressive' | 'neutral' | 'cowardly';
/** Presentation-side random draw; never touches the pure world's seeded RNG. */
export function drawPersonality(random: () => number = Math.random): Personality {
 const value=random();
 if(!Number.isFinite(value)||value<0||value>=1)throw new Error('Personality random source must return [0,1)');
 return value<0.6?'aggressive':value<0.8?'neutral':'cowardly';
}
/** A commander keeps its personality until its life or level ends. */
export class PersonalityAssignments {
 private assigned: Record<string,Personality>={};
 private random:()=>number;
 constructor(random:()=>number=Math.random){this.random=random;}
 get(tankId:string,player=false):Personality {if(player)return 'neutral';return this.assigned[tankId]??=drawPersonality(this.random);}
 forget(tankId:string):void {delete this.assigned[tankId];}
 reset():void {this.assigned={};}
}
