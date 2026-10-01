import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from './app/src/main/assets/three.module.js';
const source=fs.readFileSync(new URL('./game.mjs',import.meta.url),'utf8');
function declaration(name){
 const start=source.indexOf('const '+name+'=');if(start<0)throw Error(name);
 let i=source.indexOf('=',start)+1,depth=0,quote='',escaped=false;
 for(;i<source.length;i++){
  const ch=source[i];if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote='';continue}
  if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue}
  if(ch==='{'||ch==='['||ch==='(')depth++;
  if(ch==='}'||ch===']'||ch===')')depth--;
  if(ch===';'&&depth===0)return source.slice(start,i+1)
 }
 throw Error('Unclosed '+name)
}
function func(name){
 const start=source.indexOf('function '+name+'(');if(start<0)throw Error(name);
 let i=source.indexOf('{',start),depth=1;
 while(depth){i++;if(source[i]==='{')depth++;else if(source[i]==='}')depth--}
 return source.slice(start,i+1)
}
const ctx=vm.createContext({THREE,Math,console,playerPlane:'p36a',gameMode:'duel',enemyPlaneType:'p36a',weaponMode:'mg',enemyWeaponMode:'mg',scene:{add(){},remove(){}},playerAmmo:{m2:200,mg762:500},enemyAmmo:{m2:200,mg762:500},playerWeaponCooldowns:{},enemyWeaponCooldowns:{},updateAmmoUI(){},playSfx(){},gunSoundFor(){return'pv1Gun'}});
vm.runInContext(['AIRCRAFT_TREE','DUEL_RATING_RANGE','PROPELLER_SPECS','planeInfo','weaponInfo','AI_FIGHTER','METERS_PER_UNIT'].map(declaration).concat(['const bullets=[],bulletPool=[],bulletResources={};'],['duelOpponentsFor','chooseDuelOpponent','freshAmmo','selectedWeaponIds','updatePropeller','fireWeapons'].map(func)).flat().join('\n'),ctx);
const run=expression=>vm.runInContext(expression,ctx);
const assert=(ok,message)=>{if(!ok)throw Error(message)};
for(const type of Object.keys(run('AIRCRAFT_TREE'))){
 const rating=run(`AIRCRAFT_TREE.${type}.rating`),pool=Array.from(run(`duelOpponentsFor('${type}')`));
 assert(pool.length>0,`empty pool: ${type}`);
 for(const rival of pool)assert(Math.abs(run(`AIRCRAFT_TREE.${rival}.rating`)-rating)<=1.00000001,`BR gap: ${type}/${rival}`);
 for(const random of [0,.21,.55,.99]){ctx.random=()=>random;assert(pool.includes(run(`chooseDuelOpponent('${type}',random)`)),`bad opponent: ${type}`)}
}
assert(Array.from(run("duelOpponentsFor('p36a')")).join(',')==='bf109b1,i15bis,p36a','P-36A pool');
assert(run('planeInfo.p36a.name')==='P-36A'&&run('planeInfo.p36a.health')===320,'P-36A data');
assert(run('AI_FIGHTER.p36a.gun.m2.rangeMeters')>0&&run('AI_FIGHTER.p36a.gun.mg762.rangeMeters')>0,'P-36A AI gun rules');
assert(Array.from(run("selectedWeaponIds('p36a','mg')")).join(',')==='m2,mg762','both independent guns selected');
assert(run("freshAmmo('p36a').m2")===200&&run("freshAmmo('p36a').mg762")===500,'separate magazines');
const root=new THREE.Group();root.userData={type:'p36a',propRpm:0,propPhase:0,engineRunning:false,destroyed:false,throttle:0};ctx.root=root;
for(let i=0;i<60;i++)run('updatePropeller(root,1/60)');assert(root.userData.propRpm===0,'engine off');
root.userData.engineRunning=true;
for(const throttle of [.3,.6,1]){root.userData.throttle=throttle;for(let i=0;i<360;i++)run('updatePropeller(root,1/60)');const spec=run('PROPELLER_SPECS.p36a');assert(Math.abs(root.userData.propRpm-(spec.idleRpm+(spec.maxRpm-spec.idleRpm)*throttle))<1,`RPM throttle ${throttle}`)}
root.userData.destroyed=true;root.userData.engineRunning=false;for(let i=0;i<360;i++)run('updatePropeller(root,1/60)');assert(root.userData.propRpm===0,'destroyed prop stops');
ctx.from=new THREE.Group();ctx.from.position.set(0,60,0);
for(let i=0;i<60;i++)run('fireWeapons(from,false,1/60,true)');
const hits=Array.from(run('bullets')).reduce((s,b)=>(s[b.weapon]=(s[b.weapon]||0)+1,s),{});
assert(hits.m2>=12&&hits.m2<=14&&hits.mg762>=16&&hits.mg762<=18,`gun cadence ${JSON.stringify(hits)}`);
assert(ctx.playerAmmo.m2===200-hits.m2&&ctx.playerAmmo.mg762===500-hits.mg762,'separate ammo use');
console.log('P-36A BR, engine RPM, independent gun cadence and ammunition passed:',hits);
