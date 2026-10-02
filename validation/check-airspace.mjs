import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadGame} from './screen-runtime.mjs';

const h=loadGame(),{run,find,window}=h,checks=[];
const close=(actual,expected,tolerance=1e-7)=>assert(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const sortie=(type='f3f2')=>run(`Math.random=()=>.21;selectedAircraft='${type}';chooseDuelOpponent=()=>selectedAircraft;gameMode='airspace';reset()`);
assert(!find('#menu').classList.contains('hidden'));checks.push('Entire generated module initializes with DOM, media and graphics adapters');

const planes=run('Object.keys(planeInfo)');
for(const type of planes){
 const info=run(`planeInfo.${type}`),labels=Array.from(info.specs,row=>row[0]);
 assert.equal(labels.filter(x=>x==='水平转弯性能').length,1,type);assert.equal(labels.filter(x=>x==='垂直转弯性能').length,1,type);
 assert(!labels.some(x=>/追尾|起落架|俯仰响应|回转|转弯半径/.test(x)),type);
 for(const label of ['最大航速','最小航速'])assert(!/[（()）]/.test(info.specs.find(row=>row[0]===label)[1]));
 assert(!/低于最小|失速/.test(info.intro),type);if(type!=='i15')assert(!/起落架/.test(info.intro),type);
 sortie(type);
 assert.equal(run('airspaceUnits.length'),10);assert.equal(run("airspaceLiveUnits('blue').length"),5);assert.equal(run("airspaceLiveUnits('red').length"),5);
 assert.equal(run('airspaceUnits.filter(u=>u.isPlayer).length'),1);
 assert(run('airspaceUnits.every(u=>Math.abs(AIRCRAFT_TREE[u.type].rating-AIRCRAFT_TREE[playerPlane].rating)<=1.0+1e-9)'));
 assert.equal(run('new Set(airspaceUnits.map(u=>u.ammo)).size'),10);assert.equal(run('new Set(airspaceUnits.map(u=>u.weaponCooldowns)).size'),10);
 assert(run('airspaceUnits.every(u=>u.root.userData.velocity.clone().normalize().dot(airspaceState.point.clone().sub(airspaceState.bases[u.team]).normalize())>.9999)'));
 assert(run('airspaceUnits.every(u=>outsideTerrainMeters(u.root.position)===0)'));
 assert.deepEqual(JSON.parse(run('JSON.stringify(terrainBattleBounds())')),{minX:-300,maxX:300,minZ:-300,maxZ:300});
 assert.equal(run('airspaceState.progress'),0);assert.equal(run('airspaceState.owner'),null);assert.equal(run('airspaceState.scores.blue+airspaceState.scores.red'),0);
 assert.equal(run('groundPlane.scale.x'),600/2200);
}
checks.push('All ten catalog entries are cleaned; all aircraft generate one player + four allied AI vs five enemy AI, with independent ammunition and BR ±1.0');
checks.push('6 km square bounds and opposite diagonal bases contain every initial aircraft; headings and velocities point toward A');

for(const fps of [30,60,120]){
 sortie();run('testState=createAirspaceState();testBlue=airspaceUnits[0];testRed=airspaceUnits[5];testBlue.root.position.copy(testState.point);testRed.root.position.copy(testState.point);');
 for(let i=0;i<15*fps;i++)run(`advanceAirspaceObjective(testState,[testBlue],${1/fps})`);
 assert.equal(run('testState.owner'),'blue');close(run('testState.progress'),1);close(run('testState.scores.blue'),0);
 run('testBlue.root.position.x=31');
 for(let i=0;i<29*fps;i++)run(`advanceAirspaceObjective(testState,[testBlue,testRed],${1/fps})`);
 assert.equal(run('testState.owner'),'blue');close(run('testState.progress'),-14/15);
 for(let i=0;i<fps;i++)run(`advanceAirspaceObjective(testState,[testBlue,testRed],${1/fps})`);
 assert.equal(run('testState.owner'),'red');close(run('testState.progress'),-1);close(run('testState.scores.blue'),30);close(run('testState.scores.red'),0);
 for(let i=0;i<fps;i++)run(`advanceAirspaceObjective(testState,[testBlue,testRed],${1/fps})`);close(run('testState.scores.red'),1);
}
checks.push('A needs exactly 15 seconds from neutral and 30 from the enemy; objective and scores agree at 30/60/120 fps');
sortie();run('testState=createAirspaceState();testBlue=airspaceUnits[0];testRed=airspaceUnits[5];testBlue.root.position.copy(testState.point);testRed.root.position.copy(testState.point);advanceAirspaceObjective(testState,[testBlue,testRed],10)');
close(run('testState.progress'),0);assert.deepEqual(JSON.parse(run('JSON.stringify(testState.counts)')),{blue:1,red:1});
run('testRed.root.position.y=30.001;advanceAirspaceObjective(testState,[testBlue,testRed],3)');close(run('testState.progress'),.2);assert.equal(run('testState.counts.red'),0);
run('testBlue.root.position.set(30,0,0);testRed.root.position.set(31,0,0);advanceAirspaceObjective(testState,[testBlue,testRed],3)');close(run('testState.progress'),.4);
run('testBlue.root.position.set(25,25,0);advanceAirspaceObjective(testState,[testBlue,testRed],3)');close(run('testState.progress'),.4);assert.equal(run('testState.counts.blue'),0);
run('testBlue.root.position.copy(testState.point);testBlue.dead=true;advanceAirspaceObjective(testState,[testBlue,testRed],3)');close(run('testState.progress'),.4);assert.equal(run('testState.counts.blue'),0);
checks.push('A uses a true 300 m 3D sphere including its boundary; ties/empty/dead units never advance occupation');

for(const fps of [30,60,120]){
 sortie('mig15');run("testUnit=airspaceUnits[0];testUnit.root.position.copy(airspaceState.bases.blue);testUnit.health=100;testUnit.ammo.n37=0;testUnit.ammo.ns23=0");
 for(let i=0;i<10*fps;i++)run(`replenishAirspaceUnit(testUnit,airspaceState.bases.blue,${1/fps})`);
 close(run('testUnit.health'),600);assert.equal(run('testUnit.ammo.n37'),40);assert.equal(run('testUnit.ammo.ns23'),160);
 run('testUnit.root.position.copy(airspaceState.bases.red);testUnit.health=100;testUnit.ammo.n37=0;replenishAirspaceUnit(testUnit,airspaceState.bases.blue,10)');close(run('testUnit.health'),100);assert.equal(run('testUnit.ammo.n37'),0);
 run('testUnit.root.position.copy(airspaceState.bases.blue);testUnit.dead=true;testUnit.health=0;replenishAirspaceUnit(testUnit,airspaceState.bases.blue,10)');close(run('testUnit.health'),0);assert.equal(run('testUnit.ammo.n37'),0);
}
checks.push('Own base restores 10% maximum health/ammunition per second with fractional ammunition accounting; enemy bases and dead units cannot replenish');

sortie('f3f2');run("fireWeapons(airspaceUnits[1].root,true,1/60,true);fireWeapons(airspaceUnits[5].root,true,1/60,true)");
assert.equal(run('playerAmmo.m2'),200);assert.equal(run('airspaceUnits[1].ammo.m2'),199);assert.equal(run('airspaceUnits[5].ammo.m2'),199);assert.equal(run("bullets.filter(b=>b.team==='blue').length"),2);assert.equal(run("bullets.filter(b=>b.team==='red').length"),2);
run("for(let i=bullets.length-1;i>=0;i--)releaseBullet(i);for(const u of airspaceUnits){u.root.position.set(100,100,100);u.root.userData.frameStartPosition=u.root.position.clone()}player.position.set(0,100,0);player.quaternion.identity();airspaceUnits[1].root.position.set(0,100,-2);airspaceUnits[5].root.position.set(0,100,-5);airspaceUnits[6].root.position.set(0,100,-8);rememberAircraftFrameStart();fireWeapons(player,false,.1,true);updateAirspaceBullets(.1)");
assert.equal(run('airspaceUnits[1].health'),run('airspaceUnits[1].maxHealth'));assert(run('airspaceUnits[5].health<airspaceUnits[5].maxHealth'));assert.equal(run('airspaceUnits[6].health'),run('airspaceUnits[6].maxHealth'));
checks.push('Allied AI and enemy AI spend their own ammo; projectiles ignore friendlies and hit the first hostile along a swept path');

sortie();run('damageAirspaceUnit(airspaceUnits[0],1000,"red-0")');assert.equal(run('hp'),0);assert.equal(run('playing'),true);assert.equal(run('ended'),false);assert.equal(run('airspaceSpectating'),true);assert.equal(run("airspaceLiveUnits('blue').length"),4);assert.equal(run('airspaceUnits.length'),10);assert(!find('#spectatorControls').classList.contains('hidden'));
const first=run('airspaceViewUnit().id');find('#spectateNext').fire('click');assert.notEqual(run('airspaceViewUnit().id'),first);
const id=run('airspaceObservedId');run('damageAirspaceUnit(airspaceViewUnit(),10000)');assert.notEqual(run('airspaceViewUnit().id'),id);assert.equal(run("airspaceLiveUnits('blue').length"),3);
const deadAmmo=run('playerAmmo.m2');run('keys.fire=true;dropBomb();updateAirspaceStep(1/60)');assert.equal(run('playerAmmo.m2'),deadAmmo);assert.equal(run('player.userData.destroyed'),true);
window.showPause();const frozen=run('airspaceState.elapsed');h.advance(200);close(run('airspaceState.elapsed'),frozen);find('#again').fire('click');assert.equal(run('playing'),true);assert.equal(run('player.userData.engineRunning'),false);assert.equal(run('airspaceSpectating'),true);assert.equal(run('airspaceUnits.length'),10);
h.advance(.1);assert(run('airspaceState.elapsed')>frozen);checks.push('Player death preserves the match with no respawn; observation switches/live target fallback work; dead player cannot fire and pause/resume cannot revive them');

sortie();run("player.position.set(331,100,0);player.userData.velocity.set(0,0,0);updateDuelBoundary(15)");assert.equal(run('airspaceSpectating'),true);assert.equal(run('playing'),true);assert.equal(run('hp'),0);
sortie();run("for(const unit of airspaceLiveUnits('red'))damageAirspaceUnit(unit,100000);updateAirspaceStep(1/60)");assert.equal(run('playing'),false);assert.equal(run('airspaceState.winner'),'blue');assert.equal(run('airspaceUnits.length'),10);
sortie();run('airspaceState.owner="red";airspaceState.progress=-1;airspaceState.scores.red=99.99;updateAirspaceStep(1/60)');assert.equal(run('airspaceState.winner'),'red');assert.equal(run('playing'),false);
sortie();run('for(const unit of airspaceUnits)damageAirspaceUnit(unit,100000);updateAirspaceStep(1/60)');assert.equal(run('airspaceState.winner'),null);
sortie();assert.equal(run('wreckedAircraft.length'),0);assert.equal(run('airspaceMarkerNodes.size'),0);assert.equal(run('airspaceSpectating'),false);assert.equal(run('airspaceState.progress'),0);assert.equal(run('airspaceUnits.length'),10);
checks.push('Boundary death enters spectating; team elimination, 100-point victory and simultaneous elimination finish correctly; restart creates a clean roster');

run("gameMode='campaign';reset()");assert.equal(run('airspaceUnits.length'),0);assert.equal(run('campaignBombers.length'),3);assert.equal(run('campaignEscorts.length'),5);assert(find('#airspaceHud').classList.contains('hidden'));assert(!find('#campaignHud').classList.contains('hidden'));
h.advance(.1);assert(run('playing'));checks.push('The original campaign still starts its three bombers and five escorts and runs its own animation');
const report={result:'passed',method:'Entire embedded v18 module in Node VM with DOM/WebGL/audio adapters; actual game state, physics and combat functions.',checks};
fs.writeFileSync(new URL('airspace-v18.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
