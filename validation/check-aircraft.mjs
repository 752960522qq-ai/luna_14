import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {THREE,makeContext,plane,declaration,func,playerStep,setDirection} from './runtime.mjs';
const h=makeContext(1),run=h.run,report={result:'passed',checks:[],cadence:[],flight:[]};
vm.runInContext(declaration('AIRCRAFT_TREE')+declaration('DUEL_RATING_RANGE')+func('duelOpponentsFor')+func('chooseDuelOpponent'),h.ctx);
h.ctx.playGunShot=()=>{};
const specs=run('AIRCRAFT_SPECS.f3f2'),info=run('planeInfo.f3f2'),weapons=run('weaponInfo.f3f2');
assert.equal(specs.lengthMeters,7.06);assert.equal(specs.chaseOffsetMeters,8.7);assert.equal(info.health,360);assert.equal(info.maxSpeedKmh,425);assert.equal(info.minLevelFlightKmh,118);assert.equal(info.bestClimbMps,14);assert.equal(info.turnTimeS,16.5);assert.equal(info.verticalTurnTimeS,10.1);
assert(Math.abs(info.horizontalTurnRateDps-360/16.5)<1e-12);assert(Math.abs(info.verticalTurnRateDps-360/10.1)<1e-12);
for(const [id,expected] of [['m2',[750,34,860]],['mg762',[1000,13,810]]])assert.deepEqual([weapons[id].rpm,weapons[id].damage,weapons[id].speed],expected);
assert.deepEqual(Array.from(run("selectedWeaponIds('f3f2','mg')")),['m2','mg762']);assert.equal(run("freshAmmo('f3f2').m2"),200);assert.equal(run("freshAmmo('f3f2').mg762"),500);
assert.deepEqual(new Set(Array.from(run("duelOpponentsFor('f3f2')"))),new Set(['i15','f3f2','p36a','bf109b1','i15bis','mig3','i16','bf109c1']));report.checks.push('All supplied F3F-2 dimensions, health, speed, climb, turn and two-gun data match; BR 1.3 opponents remain within ±1.0');
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

const mig=run('planeInfo.mig3');assert.equal(mig.health,480);assert.equal(mig.maxSpeedKmh,640);assert.equal(mig.minLevelFlightKmh,155);assert.equal(mig.bestClimbMps,15.8);assert.equal(mig.turnTimeS,24);assert.equal(mig.verticalTurnTimeS,13.2);assert.equal(run('AIRCRAFT_SPECS.mig3.lengthMeters'),8.25);assert.equal(run('AIRCRAFT_SPECS.mig3.chaseOffsetMeters'),9.5);assert.equal(run('AIRCRAFT_TREE.mig3.rank'),'II');assert.equal(run('AIRCRAFT_TREE.mig3.rating'),2.3);assert.equal(run('AIRCRAFT_TREE.mig3.nation'),'ussr');
assert.deepEqual(new Set(Array.from(run("duelOpponentsFor('mig3')"))),new Set(['mig3','f3f2','p36a','bf109b1','i16','bf109c1']));
for(const fps of [30,60,120]){
 h.ctx.player=plane(h,'mig3',true,new THREE.Vector3(0,100,0),true);h.ctx.playerPlane='mig3';h.ctx.playerAmmo=run("freshAmmo('mig3')");h.ctx.playerWeaponCooldowns={};h.ctx.weaponMode='mg';h.ctx.bullets=[];h.ctx.bulletPool=[];
 for(let frame=0;frame<2*fps;frame++)run(`fireWeapons(player,false,${1/fps},true)`);
 const spent={ubs:280-h.ctx.playerAmmo.m2,shkas:1500-h.ctx.playerAmmo.mg762};assert(Math.abs(spent.ubs-100/3)<=1);assert(Math.abs(spent.shkas-120)<=2);assert.equal(spent.shkas%2,0);assert.equal(h.ctx.bullets.filter(b=>b.weapon==='mg762').length,spent.shkas);
 for(const [id,speed,damage] of [['m2',860,28],['mg762',820,15]]){const b=h.ctx.bullets.find(b=>b.weapon===id);assert.equal(b.speed*10,speed);assert.equal(b.damage,damage)}
 report.cadence.push({type:'mig3',fps,seconds:2,spent});
}
const migLevel=plane(h,'mig3',true,new THREE.Vector3(0,1000,0),true);h.ctx.player=migLevel;for(let i=0;i<90*60;i++)run('advanceAircraft(player,1/60)');assert(Math.abs(migLevel.userData.airspeed*3.6-640)<1);report.mig3LevelSpeedKmh=migLevel.userData.airspeed*3.6;
report.checks.push('MiG-3 supplied stats, Soviet Rank II/BR 2.3, ±1.0 matching, UBS cadence and two independent 1800 RPM ShKAS barrels pass');
const soviet=run('planeInfo.i15');assert.equal(soviet.health,340);assert.equal(soviet.maxSpeedKmh,365);assert.equal(soviet.minLevelFlightKmh,105);assert.equal(soviet.bestClimbMps,12.7);assert.equal(soviet.turnTimeS,13.8);assert.equal(soviet.verticalTurnTimeS,8.6);assert.equal(run('AIRCRAFT_SPECS.i15.lengthMeters'),6.1);assert.equal(run('AIRCRAFT_TREE.i15.nation'),'ussr');assert.equal(run('AIRCRAFT_TREE.i15.rating'),1.0);
for(const fps of [30,60,120]){
 h.ctx.player=plane(h,'i15',true,new THREE.Vector3(0,100,0),true);h.ctx.playerPlane='i15';h.ctx.playerAmmo=run("freshAmmo('i15')");h.ctx.playerWeaponCooldowns={};h.ctx.weaponMode='mg';h.ctx.bullets=[];h.ctx.bulletPool=[];
 for(let frame=0;frame<2*fps;frame++)run(`fireWeapons(player,false,${1/fps},true)`);
 const spent=3200-h.ctx.playerAmmo.mg;assert(Math.abs(spent-100)<=4);assert.equal(spent%4,0);assert.equal(h.ctx.bullets.length,spent);assert(h.ctx.bullets.every(b=>b.speed*10===775&&b.damage===13));report.cadence.push({type:'i15',fps,seconds:2,spent});
}
const i15Level=plane(h,'i15',true,new THREE.Vector3(0,1000,0),true);h.ctx.player=i15Level;for(let i=0;i<90*60;i++)run('advanceAircraft(player,1/60)');assert(Math.abs(i15Level.userData.airspeed*3.6-365)<1);report.i15LevelSpeedKmh=i15Level.userData.airspeed*3.6;
report.checks.push('Soviet I-15 supplied stats, BR1.0 matching, four 750RPM PV-1 barrels with 3200 total rounds and 775m/s / 13 damage, and full-power 365km/h level flight pass');
const c1=run('planeInfo.bf109c1'),c1Gun=run('weaponInfo.bf109c1.mg');
assert.equal(c1.health,390);assert.equal(c1.maxSpeedKmh,465);assert.equal(c1.minLevelFlightKmh,124);assert.equal(c1.bestClimbMps,13.2);assert.equal(c1.turnTimeS,19);assert.equal(c1.verticalTurnTimeS,11.3);
assert(Math.abs(c1.horizontalTurnRateDps-360/19)<1e-12);assert(Math.abs(c1.verticalTurnRateDps-360/11.3)<1e-12);
assert.equal(run('AIRCRAFT_TREE.bf109c1.rating'),2);assert.equal(run('AIRCRAFT_TREE.bf109c1.rank'),'II');assert.equal(run('AIRCRAFT_TREE.bf109c1.nation'),'de');assert.equal(run('AIRCRAFT_SPECS.bf109c1.lengthMeters'),8.55);assert.equal(run('AIRCRAFT_SPECS.bf109c1.chaseOffsetMeters'),2.6);
assert.deepEqual([c1Gun.rpm,c1Gun.damage,c1Gun.speed,c1Gun.count,c1Gun.cost],[1200,14,855,4,4]);
for(const fps of [30,60,120]){
 h.ctx.player=plane(h,'bf109c1',true,new THREE.Vector3(0,100,0),true);h.ctx.playerPlane='bf109c1';h.ctx.playerAmmo=run("freshAmmo('bf109c1')");h.ctx.playerWeaponCooldowns={};h.ctx.weaponMode='mg';h.ctx.bullets=[];h.ctx.bulletPool=[];
 for(let frame=0;frame<2*fps;frame++)run(`fireWeapons(player,false,${1/fps},true)`);
 const spent=1840-h.ctx.playerAmmo.mg;assert(Math.abs(spent-160)<=4);assert.equal(spent%4,0);assert.equal(h.ctx.bullets.length,spent);assert(h.ctx.bullets.every(b=>b.speed*10===855&&b.damage===14));
 h.ctx.playerAmmo.mg=4;const prior=h.ctx.bullets.length;run('fireWeapons(player,false,1,true)');assert.equal(h.ctx.playerAmmo.mg,0);assert.equal(h.ctx.bullets.length,prior+4);run('fireWeapons(player,false,1,true)');assert.equal(h.ctx.bullets.length,prior+4);
 report.cadence.push({type:'bf109c1',fps,seconds:2,spent});
}
for(const mode of ['cursor','joystick'])for(const fps of [30,120]){
 const q=plane(h,'bf109c1',true,new THREE.Vector3(0,1000,0),true);h.ctx.player=q;h.ctx.playerPlane='bf109c1';h.ctx.controlSettings.mode=mode;h.ctx.keys.up=true;h.ctx.keys.right=true;h.ctx.joystickInput={x:.65,y:.45};setDirection(h,new THREE.Vector3(.65,.25,-1).normalize());
 for(let i=0;i<fps*10;i++)playerStep(h,1/fps);assert(q.position.toArray().every(Number.isFinite));assert(Math.abs(q.quaternion.length()-1)<1e-6);report.flight.push({type:'bf109c1',mode,fps,endSpeedKmh:q.userData.airspeed*3.6});
}
const c1Level=plane(h,'bf109c1',true,new THREE.Vector3(0,1000,0),true);h.ctx.player=c1Level;for(let i=0;i<90*60;i++)run('advanceAircraft(player,1/60)');assert(Math.abs(c1Level.userData.airspeed*3.6-465)<1);report.bf109c1LevelSpeedKmh=c1Level.userData.airspeed*3.6;
report.checks.push('Bf-109 C-1 supplied stats, four 1200 RPM MG17 barrels, total 1840 rounds, 855m/s / damage14, empty ammunition, both controls and calibrated 465km/h flight pass');
fs.writeFileSync(new URL('aircraft-v19.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
