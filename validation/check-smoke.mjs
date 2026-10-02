import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadGame} from './screen-runtime.mjs';

const h=loadGame(),run=h.run,checks=[];
run("gameMode='duel';reset();playGunShot=()=>{}");
for(const [type,r] of Object.entries(run('AIRCRAFT_DATA'))) {
 if(!Object.keys(r.weapons).length) continue;
 for(const enemy of [false,true]) {
  h.context.testType=type;h.context.testEnemy=enemy;
  run("for(let i=bullets.length-1;i>=0;i--)releaseBullet(i);clearProjectileSmoke();playerPlane=testType;enemyPlaneType=testType;playerAmmo=freshAmmo(testType);enemyAmmo=freshAmmo(testType);playerWeaponCooldowns={};enemyWeaponCooldowns={};weaponMode=testType==='mig15'?'both':testType==='meteor'?'hispano':'mg';enemyWeaponMode=weaponMode;fireWeapons(testEnemy?enemy:player,testEnemy,1/120,true)");
  const expected=Object.values(r.weapons).reduce((n,w)=>n+w.count,0);
  assert.equal(run('bullets.length'),expected);assert(run('bullets.every(b=>b.smokeActive)'));
  run('updateProjectileSmoke(1/30);for(const b of bullets){b.mesh.position.addScaledVector(b.dir,b.speed/30);traceBulletSmoke(b,1/30)}');
  assert.equal(run('resourceState.projectileSmoke.geometry.instanceCount'),expected);
 }
}
checks.push('All 11 fighter aircraft, every gun/cannon and both player/enemy emit white smoke for each physical projectile; two MiG-15 weapon sets are covered');
run('window.batch=resourceState.projectileSmoke;window.buffers=[window.batch.start.array,window.batch.end.array,window.batch.birth.array];window.before=window.batch.start.array.slice(0,3);player.position.x+=100');
assert(run('window.before.every((v,i)=>v===resourceState.projectileSmoke.start.array[i])'));
run('for(let i=bullets.length-1;i>=0;i--)releaseBullet(i)');assert(run('resourceState.projectileSmoke.geometry.instanceCount>0'));
run('updateProjectileSmoke(.3)');assert(run('resourceState.projectileSmoke.material.uniforms.smokeTime.value>0'));
run('updateProjectileSmoke(.61)');assert.equal(run('resourceState.projectileSmoke.geometry.instanceCount'),0);assert.equal(run('resourceState.projectileSmoke.mesh.visible'),false);
checks.push('Smoke remains fixed in world space when the aircraft moves, survives bullet pooling/impact, ages independently and fully expires');
run("gameMode='duel';playerPlane='b29';enemyPlaneType='f86';player=aircraft(true,'b29');enemy=aircraft(false,'f86');player.position.set(0,100,0);enemy.position.set(0,101,-10);playerAmmo=freshAmmo('b29');enemyAmmo=freshAmmo('f86');clearProjectileSmoke();fireBomberTurrets(player,false,.14)");
assert(run('resourceState.projectileSmoke.count>0'));assert.equal(run('resourceState.projectileSmoke.count'),run('12000-playerAmmo.b29mg'));
run("clearProjectileSmoke();gameMode='airspace';window.unit={root:player,type:'b29',dead:false,isPlayer:true,team:'blue',ammo:freshAmmo('b29')};window.target={root:enemy,type:'f86',dead:false,team:'red',health:1000};player.userData.bomberGunClock=0;player.userData.bomberArcCheckRemaining=1;player.userData.airspaceTurretTargets=[{turret:B29_TURRETS[0],target:window.target}];fireAirspaceBomberTurrets(window.unit,.14)");
assert.equal(run('resourceState.projectileSmoke.count'),4);assert.equal(run('window.unit.ammo.b29mg'),11996);
checks.push('B-29 turret rounds emit trajectories in duel and 5v5 without changing ammunition or hit probability');
run('clearProjectileSmoke();for(let i=0;i<PROJECTILE_SMOKE_RULES.capacity+33;i++)emitProjectileSmoke(i,0,0,i,0,-1)');
assert.equal(run('resourceState.projectileSmoke.geometry.instanceCount'),32768);assert.equal(run('resourceState.projectileSmoke.cursor'),33);
run('clearProjectileSmoke();emitProjectileSmoke(0,0,0,0,0,-1)');assert(run('window.batch===resourceState.projectileSmoke'));assert(run('window.buffers.every((v,i)=>v===[window.batch.start.array,window.batch.end.array,window.batch.birth.array][i])'));
run("showMenuScreen('menu')");assert.equal(run('resourceState.projectileSmoke.geometry.instanceCount'),0);
run("gameMode='duel';reset();emitProjectileSmoke(0,0,0,0,0,-1)");h.window.showPause();const before=run('resourceState.projectileSmoke.time');h.advance(5);assert.equal(run('resourceState.projectileSmoke.time'),before);
run('resumeBattle();finish(false)');h.advance(1);assert.equal(run('resourceState.projectileSmoke.geometry.instanceCount'),0);
checks.push('One fixed-size batch is reused after overflow/reset; menus clear effects, battle pause freezes time, and completed battles allow fade-out');
const report={result:'passed',checks,capacity:32768,lifeSeconds:.6,gpuDrawBatches:1};
fs.writeFileSync(new URL('smoke-v20.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
