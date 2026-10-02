import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from './app/src/main/assets/three.module.js';

const source=fs.readFileSync(new URL('./game.mjs',import.meta.url),'utf8');
function extractFunction(name){
 const start=source.indexOf('function '+name+'(');if(start<0)throw Error('Missing '+name);
 let end=source.indexOf('{',start),depth=1;while(depth){end++;if(source[end]==='{')depth++;else if(source[end]==='}')depth--}
 return source.slice(start,end+1)
}
function extractDeclaration(name){
 const start=source.indexOf('const '+name+'=');if(start<0)throw Error('Missing '+name);
 let end=source.indexOf('=',start)+1,depth=0,quote='',escaped=false;
 for(;end<source.length;end++){
  const char=source[end];if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote='';continue}
  if(char==='"'||char==="'"||char==='`'){quote=char;continue}
  if(char==='{'||char==='['||char==='(')depth++;if(char==='}'||char===']'||char===')')depth--;
  if(char===';'&&depth===0)return source.slice(start,end+1)
 }
 throw Error('Unclosed '+name)
}
const declarations=['METERS_PER_UNIT','FLIGHT_CONTROL','AI_CONTROL','AIRCRAFT_SPECS','PROPELLER_SPECS','AIRCRAFT_TREE','planeInfo','weaponInfo','AI_TACTICS','AI_FIGHTER','AI_DUEL_CENTER'];
const functions=['freshAmmo','spawnCampaignEscort','updateCampaignEscortAI','aiFormationGoal','recoverAircraftAttitude','selectedWeaponIds','rotateAircraftLocal','rotateAircraftWorld','softLimitRate','turnRateForPlane','verticalTurnRateForPlane','flightControlAuthority','steerAircraftToward','advanceAircraft','initializeFighterAI','changeAIState','muzzleWorldPoint','solveBulletIntercept','terrainLineClear','safeAIGoal','chooseAIBreakPoint','decideFighterAI','aiFireIntent','updateFighterAI','gunSoundFor','fireWeapons','releaseBullet','updateCampaignBomberFlight'];
const bullets=[],bulletPool=[],bulletResources={},campaignBombers=[],campaignEscorts=[],scene={add(){},remove(){}},context=vm.createContext({THREE,Math,console,bullets,bulletPool,bulletResources,campaignBombers,campaignEscorts,scene,activeMapId:'korea1951',terrainHeightAt:()=>-90,enemyAmmo:{mg:1800,n37:40,ns23:160,hispano:720},enemyWeaponMode:'mg',enemyWeaponCooldowns:{mg:0,n37:0,ns23:0,hispano:0},gameMode:'duel',worldTime:0,playSfx(){},updateAmmoUI(){},playerPlane:'mig15',playerAmmo:{n37:40,ns23:160},playerWeaponCooldowns:{n37:0,ns23:0,hispano:0,mg:0},campaignBomberPhase:0,damageCampaignTarget(){throw Error('Escort hit ground')},aircraft:null});
vm.runInContext([...declarations.map(extractDeclaration),...functions.map(extractFunction)].join('\n'),context);
const run=code=>vm.runInContext(code,context),assert=(condition,message)=>{if(!condition)throw Error(message)};
function aircraft(type,position=new THREE.Vector3(0,60,0)){
 const info=run('planeInfo.'+type),speed=info.maxSpeedKmh/3.6*.6,root=new THREE.Group();root.position.copy(position);
 root.userData={type,airspeed:speed,maxSpeedMps:info.maxSpeedKmh/3.6,minFlightSpeedMps:info.minLevelFlightKmh/3.6,bestClimbMps:info.bestClimbMps,throttle:.72,velocity:new THREE.Vector3(0,0,-speed/10),ammo:type==='mig15'?{n37:40,ns23:160}:{mg:type==='bf109b1'?1000:1800},weaponCooldowns:{mg:0,n37:0,ns23:0,hispano:0},weaponMode:type==='mig15'?'both':'mg'};
 return root
}
const bfSpec=run('AIRCRAFT_SPECS.bf109b1'),bfInfo=run('planeInfo.bf109b1'),bfGun=run('weaponInfo.bf109b1.mg');
assert(bfSpec.lengthMeters===8.55&&bfInfo.health===310&&bfGun.rpm===1200&&bfGun.count===2&&bfGun.cost===2,'Bf-109 specification');
assert(run("AIRCRAFT_TREE.i15bis.nation")==='cn'&&run('AIRCRAFT_TREE.i15bis.rating')===1.0,'I-15bis Chinese tree');
assert(run('planeInfo.mig15.name')==='MIG-15','MIG-15 display name');
assert(run("gunSoundFor('meteor','hispano')")==='mig23Gun'&&run("gunSoundFor('bf109b1','mg')")==='pv1Gun','gun sound mappings');
console.log('new aircraft and country specs pass');

const target=aircraft('mig15',new THREE.Vector3(0,60,-50)),shooter=aircraft('f86');
context.target=target;context.shooter=shooter;context.center=new THREE.Vector3(0,60,0);context.enemyPlaneType='f86';
run('initializeFighterAI(shooter,"duel",0)');shooter.userData.ai.stateAge=.5;
run('decideFighterAI(shooter,target,center)');assert(shooter.userData.ai.state==='INTERCEPT','GUARD->INTERCEPT');
shooter.userData.ai.stateAge=1;run('decideFighterAI(shooter,target,center)');assert(shooter.userData.ai.state==='ALIGN','INTERCEPT->ALIGN');
shooter.userData.ai.stateAge=1;run('decideFighterAI(shooter,target,center)');assert(shooter.userData.ai.state==='FIRE_PASS','ALIGN->FIRE_PASS');
assert(run('aiFireIntent(shooter,target)').mg,'forward gun intent');
target.position.z=-3;shooter.userData.ai.stateAge=3;run('decideFighterAI(shooter,target,center)');assert(shooter.userData.ai.state==='BREAK','FIRE_PASS->BREAK');
shooter.userData.ai.stateAge=2.5;run('decideFighterAI(shooter,target,center)');assert(shooter.userData.ai.state==='INTERCEPT','duel BREAK must re-intercept without map-center condition');
shooter.userData.ai.state='ALIGN';shooter.userData.ai.stateAge=.5;target.position.z=20;run('decideFighterAI(shooter,target,center)');assert(shooter.userData.ai.state==='INTERCEPT','ALIGN behind target returns to INTERCEPT');
shooter.userData.ai.stateAge=1;target.position.z=-310;run('decideFighterAI(shooter,target,center)');assert(shooter.userData.ai.state==='INTERCEPT','target retained at 3.1km');
target.position.z=-360;run('decideFighterAI(shooter,target,center)');assert(shooter.userData.ai.state==='GUARD','target dropped beyond 3.5km');
target.position.z=-50;context.enemyAmmo={mg:0};shooter.userData.ai.stateAge=.5;run('decideFighterAI(shooter,target,center)');assert(shooter.userData.ai.state==='INTERCEPT','no ammunition must not stop pursuit');
console.log('duel state transitions, reacquisition, hysteresis and ammo independent pursuit pass');

const escort=aircraft('f86',new THREE.Vector3(112,60,0)),lead=aircraft('b29',new THREE.Vector3(0,52,-55));
context.escort=escort;context.lead=lead;run('initializeFighterAI(escort,"escort",1)');escort.userData.ai.formationRoot=lead;
target.position.set(0,60,-30);escort.userData.ai.stateAge=2;run('decideFighterAI(escort,target,center)');assert(escort.userData.ai.state==='REJOIN','early return before 1400m leash');
escort.position.x=0;target.position.set(0,60,155);escort.userData.ai.stateAge=2;run('decideFighterAI(escort,target,center)');assert(escort.userData.ai.state==='GUARD','no intercept at 1550m from bomber');
target.position.set(0,60,-50);escort.userData.ai.stateAge=.5;run('decideFighterAI(escort,target,center)');assert(escort.userData.ai.state==='INTERCEPT','escort intercepts near bomber');
console.log('escort early return and moving center threat gates pass');

context.terrainHeightAt=(x,z)=>x>20?54:-90;
const safe=run('safeAIGoal(shooter,new THREE.Vector3(330,-10,0))');assert(safe.x<=265&&safe.y>=80,'map and terrain clearance');
context.terrainHeightAt=()=>-90;

function bursts(type,dt){
 const root=aircraft(type);context.shooter=root;context.gameMode='duel';context.playerPlane=type;context.weaponMode='mg';context.playerAmmo={mg:type==='bf109b1'?1000:1800};context.playerWeaponCooldowns={mg:0,n37:0,ns23:0,hispano:0};
 for(let t=0;t<2-1e-9;t+=dt)run(`fireWeapons(shooter,false,${dt},true)`);
 const rounds=bullets.length,remaining=context.playerAmmo.mg;
 for(let i=bullets.length-1;i>=0;i--)run(`releaseBullet(${i})`);
 return{rounds,remaining}
}
const gun30=bursts('bf109b1',1/30),gun60=bursts('bf109b1',1/60);
assert(gun30.rounds===80&&gun60.rounds===80&&gun30.remaining===920&&gun60.remaining===920,'two MG-17 1200 rpm 30/60fps');
console.log('Bf-109 30/60fps 2s fire',gun30,gun60);

function encounter(dt,type='f86',duration=30){
 context.gameMode='duel';context.enemyPlaneType=type;context.enemyAmmo={mg:type==='bf109b1'?1000:1800};context.enemyWeaponCooldowns={mg:0,n37:0,ns23:0,hispano:0};
 const root=aircraft(type,new THREE.Vector3(0,60,-100)),player=aircraft('mig15',new THREE.Vector3(0,60,100));
 root.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);root.userData.velocity.set(0,0,root.userData.airspeed/10);player.userData.velocity.set(0,0,0);
 context.shooter=root;context.target=player;run('initializeFighterAI(shooter,"duel",0)');
 const states=new Set();let minDot=1,reverseSeconds=0;
 for(let time=0;time<duration-1e-8;time+=dt){context.worldTime=time;run(`updateFighterAI(shooter,target,center,${dt})`);states.add(root.userData.ai.state);minDot=Math.min(minDot,root.userData.ai.headingVelocityDot);if(root.userData.ai.headingVelocityDot<0)reverseSeconds+=dt}
 const rounds=(type==='bf109b1'?1000:1800)-context.enemyAmmo.mg;for(let i=bullets.length-1;i>=0;i--)run(`releaseBullet(${i})`);
 return{rounds,states:[...states],minDot,reverseSeconds,position:root.position.clone()}
}
const duel30=encounter(1/30),duel60=encounter(1/60);
assert(duel30.rounds>0&&duel60.rounds>0,'AI must fire');assert(Math.abs(duel30.rounds-duel60.rounds)<=18,'similar 30/60fps duel gun cadence');
assert(duel60.states.includes('INTERCEPT')&&duel60.states.includes('BREAK'),'AI attack and break');
console.log('30s duel',duel30.rounds,duel60.rounds,'states',duel60.states.join(','),'minDot',duel60.minDot.toFixed(2),'reverseSeconds',duel60.reverseSeconds.toFixed(2));
const bfDuel=encounter(1/60,'bf109b1',35);
assert(bfDuel.states.includes('INTERCEPT')&&bfDuel.minDot>0&&bfDuel.reverseSeconds===0,'Bf-109 duel AI flight');
console.log('35s Bf-109 duel',bfDuel.rounds,'states',bfDuel.states.join(','),'minDot',bfDuel.minDot.toFixed(2));

context.gameMode='duel';context.enemyPlaneType='f86';context.enemyAmmo={mg:0};context.enemyWeaponCooldowns={mg:0,n37:0,ns23:0,hispano:0};
const reverse=aircraft('f86',new THREE.Vector3(0,60,0));reverse.userData.velocity.set(0,0,15);context.shooter=reverse;context.target=aircraft('mig15',new THREE.Vector3(0,60,-50));context.target.userData.velocity.set(0,0,0);
run('initializeFighterAI(shooter,"duel",0)');let bestDot=-1,maxVelocityStep=0;
for(let time=0;time<12;time+=.02){const before=reverse.userData.velocity.clone();run('updateFighterAI(shooter,target,center,.02)');bestDot=Math.max(bestDot,reverse.userData.ai.headingVelocityDot);maxVelocityStep=Math.max(maxVelocityStep,reverse.userData.velocity.distanceTo(before))}
assert(reverse.userData.ai.recoveries>0&&bestDot>.9,'backward flight should recover nose toward airspeed');assert(maxVelocityStep<1,'velocity integration must remain bounded');
console.log('reverse recovery bestDot',bestDot.toFixed(2),'maxVelocityStep',maxVelocityStep.toFixed(3));
const slide=aircraft('f86');slide.userData.velocity.set(15,0,-5);context.shooter=slide;context.enemyAmmo={mg:0};run('initializeFighterAI(shooter,"duel",0)');
const startingLateral=Math.abs(slide.userData.velocity.x*10);let sideRecovery=false;
for(let time=0;time<10;time+=.02){run('updateFighterAI(shooter,target,center,.02)');sideRecovery||=slide.userData.ai.state==='RECOVER'}
const endingLateral=Math.abs(slide.userData.ai.lateralVelocityMps);
console.log('lateral recovery',startingLateral.toFixed(1),'->',endingLateral.toFixed(1),'m/s','state entered',sideRecovery,'dot',slide.userData.ai.headingVelocityDot.toFixed(2));
assert(sideRecovery&&slide.userData.ai.headingVelocityDot>.8&&endingLateral<startingLateral*.45,'persistent lateral flight must decay without speed reset');

const bomberOffsets=[[0,0,0],[-22,0,14],[23,-1,17]];
context.campaignEscortSerial=0;context.CAMPAIGN_ESCORT_LIMIT=5;context.gameMode='campaign';context.player=aircraft('mig15',new THREE.Vector3(0,60,100));context.player.userData.velocity.set(0,0,0);context.aircraft=(isPlayer,type)=>aircraft(type);
campaignBombers.length=0;campaignEscorts.length=0;context.campaignBomberPhase=0;
for(let i=0;i<3;i++){const root=aircraft('b29',new THREE.Vector3(bomberOffsets[i][0],52+bomberOffsets[i][1],-55+bomberOffsets[i][2]));root.userData.velocity.set(0,0,-320/3.6/10);campaignBombers.push({root,id:i+1})}
for(let i=0;i<5;i++)run('spawnCampaignEscort()');
assert(campaignEscorts.length===5,'five escorts');
assert(campaignEscorts.every(x=>x.root.userData.ai.state==='GUARD'&&new THREE.Vector3(0,0,-1).applyQuaternion(x.root.quaternion).dot(x.root.userData.velocity.clone().normalize())>.999),'spawn heading and velocity must follow B-29');
let maxCenterDistance=0,minGuardDot=1,statesAtStart=new Set();
for(let frame=0;frame<1800;frame++){
 context.worldTime=frame/60;run('updateCampaignBomberFlight(1/60)');run('updateCampaignEscortAI(1/60)');
 for(const escort of campaignEscorts){maxCenterDistance=Math.max(maxCenterDistance,escort.root.position.distanceTo(campaignBombers[0].root.position)*10);minGuardDot=Math.min(minGuardDot,escort.root.userData.ai.headingVelocityDot);if(frame<300)statesAtStart.add(escort.root.userData.ai.state)}
}
console.log('30s escort guard maxCenterDistance',maxCenterDistance.toFixed(1),'minDot',minGuardDot.toFixed(2),'opening states',Array.from(statesAtStart).join(','));
assert(maxCenterDistance<1400,'escorts should stay inside 1400m formation leash in opening');
assert(!statesAtStart.has('INTERCEPT'),'escorts should not intercept at campaign start');
const engagementStates=new Set();
for(let frame=0;frame<1200;frame++){
 context.worldTime=30+frame/60;run('updateCampaignBomberFlight(1/60)');
 context.player.position.copy(campaignBombers[0].root.position).add(new THREE.Vector3(0,8,55));context.player.userData.velocity.copy(campaignBombers[0].root.userData.velocity);
 run('updateCampaignEscortAI(1/60)');for(const escort of campaignEscorts)engagementStates.add(escort.root.userData.ai.state)
}
assert(engagementStates.has('INTERCEPT'),'escorts intercept when player enters formation');
let maxReturnDistance=0,minAttackDot=1,reverseAttackSeconds=0;
for(let frame=0;frame<1800;frame++){
 context.worldTime=50+frame/60;run('updateCampaignBomberFlight(1/60)');
 context.player.position.copy(campaignBombers[0].root.position).add(new THREE.Vector3(0,8,200));context.player.userData.velocity.copy(campaignBombers[0].root.userData.velocity);
 run('updateCampaignEscortAI(1/60)');for(const escort of campaignEscorts){maxReturnDistance=Math.max(maxReturnDistance,escort.root.position.distanceTo(campaignBombers[0].root.position)*10);minAttackDot=Math.min(minAttackDot,escort.root.userData.ai.headingVelocityDot);if(escort.root.userData.ai.headingVelocityDot<0)reverseAttackSeconds+=1/60}
}
const finalDistances=campaignEscorts.map(escort=>Math.round(escort.root.position.distanceTo(campaignBombers[0].root.position)*10));
console.log('engagement states',Array.from(engagementStates).join(','),'return max/final',maxReturnDistance.toFixed(1),finalDistances,'minDot',minAttackDot.toFixed(2),'reverse aircraft-seconds',reverseAttackSeconds.toFixed(2));
assert(finalDistances.every(distance=>distance<1000),'escorts return to moving bomber after attack');
assert(reverseAttackSeconds<.5,'normal escorts should not persistently fly backwards');
let bomberExtent=0;
for(let frame=0;frame<5500;frame++){run('updateCampaignBomberFlight(.04)');for(const bomber of campaignBombers)bomberExtent=Math.max(bomberExtent,Math.abs(bomber.root.position.x),Math.abs(bomber.root.position.z))}
assert(bomberExtent<300,'B-29 formation must remain within 6 km map');
console.log('5min B-29 map extent',bomberExtent.toFixed(2));
console.log('AI v7 acceptance passed');
