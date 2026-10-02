import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadGame} from './screen-runtime.mjs';
import {terrainGroup} from './terrain-fixture.mjs';

const h = loadGame(), {run} = h;
const checks = [], simulations = [];
assert.equal(run('controlSettings.mode'), 'joystick');
run("localStorage.setItem(CONTROL_SETTINGS_KEY, JSON.stringify({mode:'cursor',sensitivity:1.3}))");
assert.equal(run('loadControlSettings().mode'), 'cursor');
run("localStorage.setItem(CONTROL_SETTINGS_KEY, JSON.stringify({mode:'unknown'}))");
assert.equal(run('loadControlSettings().mode'), 'joystick');
checks.push('Fresh/invalid settings use the joystick; explicitly saved modes still restore.');

h.context.qaTerrain = terrainGroup();
run('planeModelLoader.loadAsync=()=>Promise.resolve({scene:qaTerrain})');
await run('loadKoreaTerrain()');
run('koreaHeightGrid=buildKoreaHeightGrid(koreaTerrain)');
const sortie = type => run(`Math.random=()=>.21;selectedAircraft='${type}';chooseDuelOpponent=()=>selectedAircraft;gameMode='airspace';reset();worldTime=0`);
sortie('mig15');
run("window.testRoot=airspaceUnits[1].root;window.testTarget=airspaceUnits[5].root;window.testRoot.position.set(0,120,0);window.testRoot.quaternion.identity();window.testRoot.userData.velocity.set(0,0,-20);window.testTarget.position.set(0,120,-150);window.testTarget.userData.velocity.set(0,0,20);updateAIFirstContact(window.testRoot,window.testTarget,1/60)");
assert.equal(run('window.testRoot.userData.ai.contact.phase'), 'MANEUVER');
assert(run('window.testRoot.userData.ai.contact.reactionRemaining>1'));
run("window.testRoot.userData.ai.state='FIRE_PASS';window.testTarget.position.z=-20");
assert.equal(run('Object.keys(aiFireIntent(window.testRoot,window.testTarget)).length'), 0);
run('updateAIFirstContact(window.testRoot,window.testTarget,2)');
assert.equal(run('window.testRoot.userData.ai.contact.phase'), 'APPROACH');
run('window.testTarget.position.z=10;updateAIFirstContact(window.testRoot,window.testTarget,.1)');
assert.equal(run('window.testRoot.userData.ai.contact.phase'), 'PULL_AWAY');
run('updateAIFirstContact(window.testRoot,window.testTarget,1.9)');
assert.equal(run('window.testRoot.userData.ai.contact.phase'), 'PULL_AWAY');
run('window.testRoot.position.z=-75;updateAIFirstContact(window.testRoot,window.testTarget,1)');
assert.equal(run('window.testRoot.userData.ai.contact.phase'), 'COMPLETE');
checks.push('Actual crossing detection requires a pass and a separated pull-away before normal combat; all opening phases suppress fire.');

run("window.testRoot.position.set(0,120,0);window.testRoot.quaternion.identity();window.testTarget.position.set(0,120,-40);window.testTarget.userData.velocity.set(0,0,20);window.testRoot.userData.ai.state='FIRE_PASS';window.testRoot.userData.ai.headingVelocityDot=1;window.testRoot.userData.boundaryReturning=false;window.testRoot.userData.instructorRecovering=false;window.testRoot.userData.weaponMode='both'");
assert.equal(run('Object.keys(aiFireIntent(window.testRoot,window.testTarget)).length'), 0);
run('window.testTarget.position.z=-25');
assert(run('Object.keys(aiFireIntent(window.testRoot,window.testTarget)).length') > 0);
run('window.testTarget.position.x=2');
assert.equal(run('Object.keys(aiFireIntent(window.testRoot,window.testTarget)).length'), 0);
run('window.testTarget.position.x=0;for(let i=0;i<20;i++)aiFireIntent(window.testRoot,window.testTarget,1/60)');
assert(run('window.testRoot.userData.ai.headOnPauseRemaining>0'));
assert.equal(run('Object.keys(aiFireIntent(window.testRoot,window.testTarget)).length'), 0);
checks.push('Head-on fire rejects 400 m and inaccurate shots, permits an aligned 250 m prediction, then stops after a short burst.');

for (const type of ['i15', 'f3f2', 'mig15']) {
  sortie(type);
  run("window.seed=257;Math.random=()=>{window.seed=(1664525*window.seed+1013904223)>>>0;return window.seed/4294967296};window.firstShots={};window.crossed={};window.openingViolations=0;window.firstLoss=null;window.minClearance=Infinity;window.reactions=new Map();window.phases=new Set();window.completeFrames=0");
  // Auto-fly the player slot as well, so both full formations can be compared.
  run("airspaceUnits[0].isPlayer=false;initializeFighterAI(player,'airspace',0)");
  run(`for(let frame=0;frame<60*110;frame++){
    const dt=1/60;worldTime+=dt;rememberAircraftFrameStart();
    for(const u of airspaceLiveUnits()){
      const before=bullets.length;updateAirspaceAI(u,dt);
      const c=u.root.userData.ai.contact;window.phases.add(c.phase);
      if(c.phase!=='UNSEEN'&&!window.reactions.has(u.id))window.reactions.set(u.id,c.reactionRemaining+dt);
      if(c.phase==='COMPLETE'&&!window.crossed[u.id])window.crossed[u.id]=worldTime;
      if(bullets.length>before){if(c.phase!=='COMPLETE'||c.reactionRemaining>0)window.openingViolations++;window.firstShots[u.id]??=worldTime;}
      window.minClearance=Math.min(window.minClearance,(u.root.position.y-terrainHeightAt(u.root.position.x,u.root.position.z))*10);
    }
    updateAirspaceBullets(dt);
    for(const u of airspaceLiveUnits())if(u.root.position.y<=terrainHeightAt(u.root.position.x,u.root.position.z))damageAirspaceUnit(u,u.health);
    if(airspaceLiveUnits().length<10&&window.firstLoss===null)window.firstLoss=worldTime;
    advanceAirspaceObjective(airspaceState,airspaceUnits,dt);
  }`);
  const result = JSON.parse(run(`JSON.stringify({type:'${type}',alive:airspaceLiveUnits().length,firstLoss:window.firstLoss,phases:[...window.phases],crossed:window.crossed,firstShots:window.firstShots,openingViolations:window.openingViolations,minClearanceMeters:window.minClearance,reactionDelays:[...window.reactions.values()]})`));
  assert.equal(result.openingViolations, 0);
  assert(result.phases.includes('PULL_AWAY') && result.phases.includes('COMPLETE'), JSON.stringify(result));
  assert.equal(Object.keys(result.crossed).length, 10, JSON.stringify(result));
  assert(result.reactionDelays.every(x => x >= 1 && x <= 2));
  assert(Math.max(...result.reactionDelays) - Math.min(...result.reactionDelays) > .3);
  assert(result.minClearanceMeters > 0, JSON.stringify(result));
  assert(Object.keys(result.firstShots).length > 0, 'AI must resume firing after separation: ' + JSON.stringify(result));
  for (const [id, time] of Object.entries(result.firstShots)) assert(time >= result.crossed[id]);
  simulations.push(result);
}
checks.push('110-second, ten-aircraft simulations on the packaged four-tile terrain: varied 1–2 s delays, no opening shots, every AI separates, stays above terrain and resumes combat.');
const report = {result: 'passed', checks, simulations};
fs.writeFileSync(new URL('first-contact-v21.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
