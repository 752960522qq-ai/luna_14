import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {THREE,makeContext,plane,declaration,func,playerStep,setDirection} from './runtime.mjs';
const h=makeContext(1),run=h.run,report={result:'passed',checks:[],cadence:[],flight:[]};
vm.runInContext(declaration('AIRCRAFT_TREE')+declaration('DUEL_RATING_RANGE')+func('duelOpponentsFor')+func('chooseDuelOpponent'),h.ctx);
h.ctx.playGunShot=()=>{};
const specs=run('AIRCRAFT_SPECS.f3f2'),info=run('planeInfo.f3f2'),weapons=run('weaponInfo.f3f2');
assert.equal(specs.lengthMeters,7.06);assert.equal(specs.chaseOffsetMeters,2.3);assert.equal(info.health,360);assert.equal(info.maxSpeedKmh,425);assert.equal(info.minLevelFlightKmh,118);assert.equal(info.bestClimbMps,14);assert.equal(info.turnTimeS,16.5);assert.equal(info.verticalTurnTimeS,10.1);
assert(Math.abs(info.horizontalTurnRateDps-360/16.5)<1e-12);assert(Math.abs(info.verticalTurnRateDps-360/10.1)<1e-12);
for(const [id,expected] of [['m2',[750,34,860]],['mg762',[1000,13,810]]])assert.deepEqual([weapons[id].rpm,weapons[id].damage,weapons[id].speed],expected);
assert.deepEqual(Array.from(run("selectedWeaponIds('f3f2','mg')")),['m2','mg762']);assert.equal(run("freshAmmo('f3f2').m2"),200);assert.equal(run("freshAmmo('f3f2').mg762"),500);
assert.deepEqual(new Set(Array.from(run("duelOpponentsFor('f3f2')"))),new Set(['f3f2','p36a','bf109b1','i15bis','mig3']));report.checks.push('All supplied F3F-2 dimensions, health, speed, climb, turn and two-gun data match; BR 1.3 opponents remain within ±1.0');
for(const fps of [30,60,120]){
 const q=plane(h,'f3f2',true,new THREE.Vector3(0,100,0),true);h.ctx.player=q;h.ctx.playerPlane='f3f2';h.ctx.playerAmmo=run("freshAmmo('f3f2')");h.ctx.playerWeaponCooldowns={};h.ctx.weaponMode='mg';h.ctx.bullets=[];h.ctx.bulletPool=[];
 for(let frame=0;frame<2*fps;frame++)run(`fireWeapons(player,false,${1/fps},true)`);
 const spent={m2:200-h.ctx.playerAmmo.m2,mg762:500-h.ctx.playerAmmo.mg762};assert(Math.abs(spent.m2-25)<=1);assert(Math.abs(spent.mg762-100/3)<=1);
 assert.equal(h.ctx.bullets.filter(b=>b.weapon==='m2').length,spent.m2);assert.equal(h.ctx.bullets.filter(b=>b.weapon==='mg762').length,spent.mg762);
 const m2=h.ctx.bullets.find(b=>b.weapon==='m2'),mg=h.ctx.bullets.find(b=>b.weapon==='mg762');assert.equal(m2.damage,34);assert.equal(mg.damage,13);assert.equal(m2.speed*10,860);assert.equal(mg.speed*10,810);
 h.ctx.playerAmmo.m2=0;h.ctx.playerAmmo.mg762=0;const count=h.ctx.bullets.length;run('fireWeapons(player,false,.1,true)');assert.equal(h.ctx.bullets.length,count);
 report.cadence.push({fps,seconds:2,spent});
}
report.checks.push('Two independent gun cadences, projectile speed/damage and empty-ammunition behavior pass at 30/60/120 fps');
for(const mode of ['cursor','joystick'])for(const fps of [30,120]){
 const q=plane(h,'f3f2',true,new THREE.Vector3(0,1000,0),true);h.ctx.player=q;h.ctx.playerPlane='f3f2';h.ctx.controlSettings.mode=mode;h.ctx.keys.up=true;h.ctx.keys.right=true;h.ctx.joystickInput={x:.65,y:.45};setDirection(h,new THREE.Vector3(.65,.25,-1).normalize());
 for(let frame=0;frame<fps*10;frame++)playerStep(h,1/fps);
 assert(q.position.toArray().every(Number.isFinite));assert(q.quaternion.toArray().every(Number.isFinite));assert(Math.abs(q.quaternion.length()-1)<1e-6);assert(q.userData.airspeed>0&&Number.isFinite(q.userData.aoa));
 report.flight.push({mode,fps,seconds:10,endSpeedKmh:q.userData.airspeed*3.6,aoaDegrees:q.userData.aoa*180/Math.PI});
}
report.checks.push('New aircraft remains finite and normalized in both control modes at low/high frame rates');
const level=plane(h,'f3f2',true,new THREE.Vector3(0,1000,0),true);h.ctx.player=level;h.ctx.playerPlane='f3f2';
for(let frame=0;frame<120*60;frame++)run('advanceAircraft(player,1/60)');
const levelSpeed=level.userData.airspeed*3.6;assert(Math.abs(levelSpeed-425)<1,'F3F-2 full-throttle level speed is not calibrated');
report.levelSpeedKmh=levelSpeed;report.checks.push('Fully-spooled level flight settles within 1 km/h of the supplied 425 km/h');
const turnSpeeds=[];
for(const coefficient of [.014,0]){
 run(`AIRCRAFT_SPECS.f3f2.highSpeedTurnDrag=${coefficient}`);
 const q=plane(h,'f3f2',true,new THREE.Vector3(0,1000,0),true);q.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,-1),THREE.MathUtils.degToRad(72));q.userData.airspeed=410/3.6;q.userData.velocity.set(0,0,-q.userData.airspeed/10);h.ctx.player=q;
 for(let frame=0;frame<120*4;frame++)run('advanceAircraft(player,1/120)');turnSpeeds.push(q.userData.airspeed*3.6);
}
run('AIRCRAFT_SPECS.f3f2.highSpeedTurnDrag=.014');assert(turnSpeeds[0]<turnSpeeds[1]-1);
report.highSpeedTurn={withAdditionalLossKmh:turnSpeeds[0],withoutAdditionalLossKmh:turnSpeeds[1],seconds:4};report.checks.push('Loaded high-speed turns lose more energy than the same maneuver without the F3F-2 turn-drag setting');

const mig=run('planeInfo.mig3');assert.equal(mig.health,480);assert.equal(mig.maxSpeedKmh,640);assert.equal(mig.minLevelFlightKmh,155);assert.equal(mig.bestClimbMps,15.8);assert.equal(mig.turnTimeS,24);assert.equal(mig.verticalTurnTimeS,13.2);assert.equal(run('AIRCRAFT_SPECS.mig3.lengthMeters'),8.25);assert.equal(run('AIRCRAFT_SPECS.mig3.chaseOffsetMeters'),2.7);assert.equal(run('AIRCRAFT_TREE.mig3.rank'),'II');assert.equal(run('AIRCRAFT_TREE.mig3.rating'),2.3);assert.equal(run('AIRCRAFT_TREE.mig3.nation'),'ussr');
assert.deepEqual(new Set(Array.from(run("duelOpponentsFor('mig3')"))),new Set(['mig3','f3f2','p36a','bf109b1']));
for(const fps of [30,60,120]){
 h.ctx.player=plane(h,'mig3',true,new THREE.Vector3(0,100,0),true);h.ctx.playerPlane='mig3';h.ctx.playerAmmo=run("freshAmmo('mig3')");h.ctx.playerWeaponCooldowns={};h.ctx.weaponMode='mg';h.ctx.bullets=[];h.ctx.bulletPool=[];
 for(let frame=0;frame<2*fps;frame++)run(`fireWeapons(player,false,${1/fps},true)`);
 const spent={ubs:280-h.ctx.playerAmmo.m2,shkas:1500-h.ctx.playerAmmo.mg762};assert(Math.abs(spent.ubs-100/3)<=1);assert(Math.abs(spent.shkas-120)<=2);assert.equal(spent.shkas%2,0);assert.equal(h.ctx.bullets.filter(b=>b.weapon==='mg762').length,spent.shkas);
 for(const [id,speed,damage] of [['m2',860,28],['mg762',820,15]]){const b=h.ctx.bullets.find(b=>b.weapon===id);assert.equal(b.speed*10,speed);assert.equal(b.damage,damage)}
 report.cadence.push({type:'mig3',fps,seconds:2,spent});
}
const migLevel=plane(h,'mig3',true,new THREE.Vector3(0,1000,0),true);h.ctx.player=migLevel;for(let i=0;i<90*60;i++)run('advanceAircraft(player,1/60)');assert(Math.abs(migLevel.userData.airspeed*3.6-640)<1);report.mig3LevelSpeedKmh=migLevel.userData.airspeed*3.6;
report.checks.push('MiG-3 supplied stats, Soviet Rank II/BR 2.3, ±1.0 matching, UBS cadence and two independent 1800 RPM ShKAS barrels pass');
fs.writeFileSync(new URL('aircraft-v15.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
