import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {THREE,func,declaration} from './runtime.mjs';

const sources=[],fallback=[],report={method:'Actual generated v15 audio and weapon functions, Web Audio/HTML audio adapters; PCM checks are separate.',checks:[],cadence:[]};
class Param{constructor(){this.value=0;this.events=[]}setTargetAtTime(value,time,constant){this.value=value;this.events.push({value,time,constant})}cancelScheduledValues(){}}
class Audio{constructor(path){this.src=path;this.paused=true;fallback.push(this)}load(){}pause(){this.paused=true}play(){this.paused=false;return Promise.resolve()}}
class Context{
 constructor(){this.currentTime=0;this.state='running';this.destination={}}
 createDynamicsCompressor(){return{threshold:new Param(),knee:new Param(),ratio:new Param(),attack:new Param(),release:new Param(),connect(){}}}
 createGain(){return{gain:new Param(),connect(){},disconnect(){}}}
 createBufferSource(){const node={loop:false,playbackRate:new Param(),connect(){},disconnect(){},start(time=0){this.startAt=time;this.started=true},stop(time=0){this.stopAt=time}};sources.push(node);return node}
 resume(){this.state='running';return Promise.resolve()}
 decodeAudioData(raw){const view=new DataView(raw);return Promise.resolve({duration:view.getUint32(40,true)/view.getUint32(28,true)})}
}
const real=fs.readFileSync(new URL('../game.mjs',import.meta.url),'utf8'),base=real.slice(real.indexOf('const AUDIO_FILES='),real.indexOf('function updateEngineUI('));
const ctx=vm.createContext({THREE,Math,console,Audio,fetch:async path=>{const buf=fs.readFileSync(new URL('../app/src/main/assets/'+path.replace('./',''),import.meta.url));return{ok:true,arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)}},window:{AudioContext:Context},performance:{now:()=>ctx.now*1000},now:0,playing:true,playerPlane:'f86',enemyPlaneType:'f86',gameMode:'duel',keys:{fire:false},player:null,enemy:null,throttleValue:1,scene:{add(){}},updateAmmoUI(){},toast(){},damage(){},playerAmmo:{},enemyAmmo:{},playerWeaponCooldowns:{},enemyWeaponCooldowns:{},weaponMode:'mg',enemyWeaponMode:'mg'});
vm.runInContext(base,ctx);const run=s=>vm.runInContext(s,ctx);run('prepareGameAudio()');await Promise.all(run('[...audioLoads.values()]'));assert.equal(run('audioBuffers.size'),9);report.checks.push('Nine PCM slices decode and preload; no long engine recording loaded');
const functions=['fireWeapons','fireBomberTurrets','bomberTurretCanTrack','selectedWeaponIds','gunSoundFor'],declarations=['weaponInfo','METERS_PER_UNIT','PROPELLER_SPECS','B29_TURRETS'];
vm.runInContext(declarations.map(declaration).concat(functions.map(func)).join('\n')+'\nconst bullets=[],bulletPool=[],bulletResources={};',ctx);
function plane(type){const p=new THREE.Group();p.position.set(0,100,0);p.userData={type,throttle:1,engineRunning:true,propRpm:type==='bf109b1'?2300:1900,bomberGunClock:0,bomberGunsActive:false};return p}
function clear(){sources.length=0;run('stopGunSounds();nextGunStart=new WeakMap()');ctx.playerWeaponCooldowns={};ctx.enemyWeaponCooldowns={}}
for(const [type,mode,ammo,ids] of [['mig3','mg',{m2:280,mg762:1500},['m2','mg762']],['f86','mg',{mg:1800},['mg']],['bf109b1','mg',{mg:1000},['mg']],['i15bis','mg',{mg:3050},['mg']],['p36a','mg',{m2:200,mg762:500},['m2','mg762']],['f3f2','mg',{m2:200,mg762:500},['m2','mg762']],['mig15','both',{n37:40,ns23:160},['n37','ns23']],['meteor','hispano',{hispano:720},['hispano']]]){
 clear();ctx.player=plane(type);ctx.playerPlane=type;ctx.weaponMode=mode;ctx.playerAmmo={...ammo};
 run('fireWeapons(player,false,1/60,true)');assert.equal(sources.length,ids.length,`${type}: short trigger played multiple recorded shots`);assert(sources.every(s=>!s.loop&&s.buffer.duration<=.34+1e-8));
 const count=sources.length;run('fireWeapons(player,false,1/60,false)');assert.equal(sources.length,count);report.checks.push(`${type}: tap produces one sample per selected weapon, release emits no new sample`);
}
for(const fps of [30,60,120]){
 clear();ctx.player=plane('bf109b1');ctx.playerPlane='bf109b1';ctx.weaponMode='mg';ctx.playerAmmo={mg:1000};
 for(let frame=0;frame<fps*2;frame++){ctx.now=frame/fps;run(`audioContext.currentTime=${ctx.now};fireWeapons(player,false,${1/fps},true)`)}
 assert.equal(sources.length,40,`1200 rpm cadence at ${fps}`);assert.equal(ctx.playerAmmo.mg,920);report.cadence.push({type:'bf109b1',fps,seconds:2,samples:40,rounds:80});
 const count=sources.length;ctx.playerAmmo.mg=0;run('fireWeapons(player,false,.2,true)');assert.equal(sources.length,count,'Empty magazine still makes gunfire');
}
report.checks.push('Sample cadence follows physical shots, independently of old global 220 ms sound suppression; empty ammunition is silent');
// Same sound on two different aircraft must not suppress either aircraft.
clear();ctx.player=plane('f86');ctx.enemy=plane('f86');ctx.playerPlane='f86';ctx.enemyPlaneType='f86';ctx.playerAmmo={mg:1800};ctx.enemyAmmo={mg:1800};run('fireWeapons(player,false,.01,true);fireWeapons(enemy,true,.01,true)');assert.equal(sources.length,2);report.checks.push('Player and enemy with the same sound do not suppress each other');
// A pending catch-up shot must not play after release or after audio resumes.
clear();ctx.player=plane('bf109b1');ctx.playerPlane='bf109b1';ctx.playerAmmo={mg:1000};ctx.keys.fire=true;run('fireWeapons(player,false,.1,true)');ctx.keys.fire=false;run('stopPendingGunSounds()');assert(sources.filter(x=>x.startAt>run('audioContext.currentTime')+.001).every(x=>x.stopAt!==undefined));
const count=sources.length;run("audioContext.state='suspended';playGunShot('pv1Gun',player,false,.05);audioContext.state='running'");assert.equal(sources.length,count);report.checks.push('Release cancels future player sounds; suspended/unloaded audio never replays queued shots');
// Stationary engine has one looping buffer through repeated throttle changes.
clear();ctx.player=plane('f86');ctx.playerPlane='f86';run("startEngineSound('f86')");assert.equal(sources.length,1);assert(sources[0].loop&&sources[0].buffer.duration===11.7);const engine=sources[0];
for(const throttle of [.3,.6,1]){ctx.player.userData.throttle=throttle;run('updateEngineAudio()')}
run("startEngineSound('f86')");assert.equal(sources.length,1,'Engine recording restarted');assert(engine.playbackRate.events.length>=3);run('stopEngineSound()');assert(engine.stopAt!==undefined);assert.equal(run('engineAudio'),null);report.checks.push('Jet engine uses one stationary looping node; throttle changes gain/pitch without restarting; pause stops it');
clear();ctx.player=plane('bf109b1');ctx.playerPlane='bf109b1';run("startEngineSound('bf109b1')");ctx.player.userData.engineRunning=false;ctx.player.userData.propRpm=0;run('updateEngineAudio()');assert.equal(run('engineAudio'),null);report.checks.push('Propeller engine sound follows RPM and stops at zero');
clear();ctx.player=plane('f3f2');ctx.playerPlane='f3f2';run("startEngineSound('f3f2')");assert.equal(run('engineAudioType'),'prop');assert(sources[0].loop);run('stopEngineSound()');report.checks.push('F3F-2 uses the existing stationary propeller loop and short per-weapon samples');
clear();ctx.player=plane('mig3');ctx.playerPlane='mig3';run("startEngineSound('mig3')");assert.equal(run('engineAudioType'),'prop');assert.equal(sources[0].buffer,run("audioBuffers.get('i15Engine')"));assert.equal(run("gunSoundFor('mig3','m2')"),'pv1Gun');assert.equal(run("gunSoundFor('mig3','mg762')"),'pv1Gun');run('stopEngineSound()');report.checks.push('MiG-3 uses the exact I-15 piston engine buffer and I-15 machine gun samples for both guns');
// Decode completion cannot resurrect an engine that was stopped while loading.
clear();ctx.player=plane('f86');ctx.playerPlane='f86';run("audioBuffers.delete('jetEngine');audioLoads.delete('jetEngine');startEngineSound('f86');stopEngineSound()");
await Promise.all(run('[...audioLoads.values()]'));await Promise.resolve();assert.equal(run('engineAudio'),null);assert.equal(sources.length,0);report.checks.push('Late decoder completion after pause does not start an engine voice');
// Turrets: no sound until a real firing packet deducts rounds.
clear();ctx.player=plane('b29');ctx.playerPlane='b29';ctx.enemy=plane('f86');ctx.enemy.position.set(0,100,-10);ctx.playerAmmo={b29mg:12000};
run('fireBomberTurrets(player,false,.1)');assert.equal(sources.length,0);run('fireBomberTurrets(player,false,.04)');assert.equal(sources.length,1);assert(ctx.playerAmmo.b29mg<12000);ctx.enemy.position.z=-1000;run('fireBomberTurrets(player,false,.2)');assert.equal(sources.length,1);report.checks.push('B-29 turret packet plays once only when rounds are spent; no out-of-range loop');
assert(!real.includes('setPV1GunLoop')&&!real.includes('setBomberGunLoop'));
fs.writeFileSync(new URL('audio-behavior-v15.json',import.meta.url),JSON.stringify({...report,result:'passed'},null,2));console.log(JSON.stringify({...report,result:'passed'},null,2));
