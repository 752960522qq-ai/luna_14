import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadGame} from './screen-runtime.mjs';

const h = loadGame(), {run, find} = h, checks = [];
const close = (a,b) => assert(Math.abs(a-b)<1e-7, `${a} != ${b}`);
const sortie = () => run("selectedAircraft='bf109c1';gameMode='airspace';reset();for(const u of airspaceUnits){u.root.position.set(u.team==='blue'?-150:150,130,u.index*10);u.root.userData.velocity.set(0,0,0)}");

for (const [blue,red,blueLive,redLive,winner] of [[18,17,1,5,'blue'],[17,18,5,1,'red'],[20,20,4,3,'blue'],[20,20,3,4,'red'],[20,20,4,4,null]]) {
  sortie(); run(`airspaceState.elapsed=300;airspaceState.scores.blue=${blue};airspaceState.scores.red=${red};
    airspaceUnits.filter(u=>u.team==='blue').forEach((u,i)=>{u.dead=i>=${blueLive}});
    airspaceUnits.filter(u=>u.team==='red').forEach((u,i)=>{u.dead=i>=${redLive}});updateAirspaceStep(1/60)`);
  assert.equal(run('airspaceState.winner'),winner); assert.equal(run('ended'),true);
  assert.equal(find('#airspaceTimer').textContent,'00:00');
  assert.equal(find('#resultTitle').textContent,winner===null?'平局':winner==='blue'?'胜利':'失败');
}
sortie(); run('airspaceState.elapsed=299.99;airspaceState.scores.blue=30;airspaceState.scores.red=20;updateAirspaceStep(4)');
close(run('airspaceState.elapsed'),300); close(run('battleRewardSeconds'),.01);
const paid = run('economy.gp'); run("finishAirspaceBattle('blue')"); assert.equal(run('economy.gp'),paid);
checks.push('At 300 seconds: points override survival, tied points use live counts, double ties draw; overshoot is clamped and rewards settle once');

sortie(); run('updateAirspaceStep(1/60)'); const clock=run('airspaceState.elapsed'), survival=run('session.combatStats.survival');
h.window.showPause(); h.advance(60); close(run('airspaceState.elapsed'),clock);close(run('session.combatStats.survival'),survival);
find('#again').fire('click'); run('damageAirspaceUnit(airspaceUnits[0],10000,"red-0");updateAirspaceStep(1/60)');
close(run('session.combatStats.survival'),survival); assert(run('airspaceState.elapsed')>clock);
checks.push('Pause freezes countdown and lifetime; spectating continues the match clock but cannot extend player survival');

sortie();run('fireWeapons(player,false,1/120,true)');assert.equal(run('session.combatStats.shots'),4);assert.equal(run('playerAmmo.mg'),1836);
run("globalThis.victim=airspaceUnits[5];globalThis.point=victim.root.localToWorld(new THREE.Vector3(0,0,-victim.root.userData.collisionHalfExtents.z*.8));damageAirspaceUnit(victim,14,'blue-0',{source:player,point,projectile:true,hits:1})");
assert.equal(run('session.combatStats.hits'),1);assert(find('#reticle').classList.contains('hit-confirm'));
assert(run('resourceState.combatEffects.life.slice(0,192).some(x=>x>0)'));
run("damageAirspaceUnit(airspaceUnits[1],14,'blue-0',{source:player,point,projectile:true,hits:1})");assert.equal(run('session.combatStats.hits'),1);
run("damageAirspaceUnit(airspaceUnits[0],30,'red-0');damageAirspaceUnit(airspaceUnits[0],10000,'red-0')");
assert.equal(run('session.combatStats.damageTaken'),390);
run("finishAirspaceBattle('red')");assert.equal(find('#resultAccuracy').textContent,'25.0%');assert.equal(find('#resultDamage').textContent,390);
assert(!find('#battleResults').classList.contains('hidden'));assert.equal(find('#again').textContent,'再次出战');
find('#returnHome').fire('click');assert(!find('#hangar').classList.contains('hidden'));assert(!run('session.combatStats.active'));
checks.push('Four MG17 projectiles count as four shots; hostile impacts count once, friendlies do not; overkill damage is capped and actual result values render');

sortie();run("globalThis.victim=airspaceUnits[5];globalThis.half=victim.root.userData.collisionHalfExtents;globalThis.wing=victim.root.localToWorld(new THREE.Vector3(half.x*.8,0,half.z*.5));damageAirspaceUnit(victim,victim.maxHealth*.2,'blue-0',{source:player,point:wing,projectile:true,hits:1});updateCombatFeedback(.1)");
assert(!run('victim.root.userData.engineCritical'));assert(run('victim.root.userData.heavySmokeRemaining')>0);assert(run('resourceState.combatEffects.life.slice(192).some(x=>x>0)'));
run('updateCombatFeedback(3)');assert.equal(run('victim.root.userData.heavySmokeRemaining'),0);assert(!run('resourceState.combatEffects.life.some(x=>x>0)'));
sortie();run("globalThis.victim=airspaceUnits[5];globalThis.point=victim.root.localToWorld(new THREE.Vector3(0,0,-victim.root.userData.collisionHalfExtents.z*.8));damageAirspaceUnit(victim,victim.maxHealth*.3,'blue-0',{source:player,point,projectile:true,hits:1});updateCombatFeedback(3)");
assert(run('victim.root.userData.engineCritical'));assert.equal(run('victim.root.userData.heavySmokeRemaining'),0);assert(run('resourceState.combatEffects.life.slice(192).some(x=>x>0)'));
run('victim.root.position.copy(airspaceState.bases.red);replenishAirspaceUnit(victim,airspaceState.bases.red,10)');assert(!run('victim.root.userData.engineCritical'));
const capacity=run('resourceState.combatEffects.capacity');run('for(let i=0;i<800;i++)emitImpactSparks(player.position,8)');assert.equal(run('resourceState.combatEffects.capacity'),capacity);
run("showMenuScreen('menu')");assert(!run('resourceState.combatEffects.life.some(x=>x>0)'));assert(!find('#reticle').classList.contains('hit-confirm'));
checks.push('Wing damage produces temporary black smoke; local engine hits produce sustained smoke until repaired; particles have fixed capacity and menus clear feedback');

sortie();run("globalThis.victim=airspaceUnits[5];damageAirspaceUnit(victim,victim.maxHealth*.1,'blue-0');damageAirspaceUnit(victim,10000,'blue-1')");
assert.equal(run('session.combatStats.assists'),1);assert.equal(run('kills'),0);assert(find('#killFeed').children[0].textContent.includes('助攻：'));
run("damageAirspaceUnit(victim,10000,'blue-1')");assert.equal(run('session.combatStats.assists'),1);
sortie();run("globalThis.victim=airspaceUnits[5];damageAirspaceUnit(victim,victim.maxHealth*.1,'blue-0');airspaceState.elapsed=31;damageAirspaceUnit(victim,10000,'blue-1')");assert.equal(run('session.combatStats.assists'),0);
sortie();run("damageAirspaceUnit(airspaceUnits[5],10000,'blue-0')");assert.equal(run('kills'),1);assert.equal(run('session.combatStats.assists'),0);
checks.push('Recent meaningful damage followed by a teammate kill grants one assist; expired contributions, duplicate death events and self-finishing kills do not');

const name=run('profileState.playerName');assert(/^player_\d{4}$/.test(name));
find('#profileNameInput').value='银翼队长';assert(run('savePlayerName()'));
const saved=JSON.parse(h.storage.get('silverwing.profile.1.0'));assert.equal(saved.playerName,'银翼队长');assert.equal(loadGame({profile:saved}).run('profileState.playerName'),'银翼队长');
run('window.save=localStorage.setItem;localStorage.setItem=()=>{throw new Error("full")};');find('#profileNameInput').value='另一名飞行员';assert(!run('savePlayerName()'));assert.equal(run('profileState.playerName'),'银翼队长');run('localStorage.setItem=window.save');
find('#profileNameInput').value='<script>';assert(!run('savePlayerName()'));
checks.push('Random player_xxxx names persist, edits support Chinese, and invalid names or storage errors preserve the existing profile');

const report={result:'passed',checks,method:'Actual generated game module, deterministic DOM/audio adapters; native video and GPU acceptance are covered by the browser check'};
fs.writeFileSync(new URL('combat-update-v20.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
