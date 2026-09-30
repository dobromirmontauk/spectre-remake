// Presentation-only copy: movement/simulation and authorized perception stay unchanged.
export function canonicalHeading(value) {
 if(typeof value!=='number'||!Number.isFinite(value))return value;
 const period=2*Math.PI;return ((value%period)+period)%period;
}
export function providerObservation(observation) {
 const copy=structuredClone(observation);
 if(copy.own?.heading!==undefined)copy.own.heading=canonicalHeading(copy.own.heading);
 for(const group of [copy.contacts,copy.memory])if(Array.isArray(group))for(const contact of group)if(contact.kind==='tank'&&contact.heading!==undefined)contact.heading=canonicalHeading(contact.heading);
 return copy;
}
export const OBSERVATION_CONVENTIONS='Positions x/z and distances are game units in the horizontal arena plane; speed is signed game units/second (negative means reverse). Heading is radians in [0, 2*pi): 0 faces +z, pi/2 faces +x; forward direction is (sin(heading), cos(heading)), bearing to a point is atan2(delta x, delta z). At levels 1–2 own position, flag/supply positions and visited navigation positions are rounded to the nearest 10 game units; observed tank positions remain precise. Level 3+ authorized positions are precise; map access to flags/supplies does not reveal hidden opponents. Source own means personally observed; shared means squad report, not own line of sight; map means authorized objective/supply map. nowSeconds, seenSeconds and ageSeconds are simulation seconds; tick/seenTick use 30 ticks/second. Remembered/reported positions are dated, never guaranteed current.';
