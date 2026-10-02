import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as THREE from './app/src/main/assets/three.module.js';

const source=fs.readFileSync(new URL('./game.mjs',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./app/src/main/assets/index.html',import.meta.url),'utf8');
function declaration(name){
 const start=source.indexOf('const '+name+'=');assert(start>=0,name);
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
 const start=source.indexOf('function '+name+'(');assert(start>=0,name);
 let i=source.indexOf('{',start),depth=1;
 while(depth){i++;if(source[i]==='{')depth++;else if(source[i]==='}')depth--}
 return source.slice(start,i+1)
}
class Node {
 constructor(){this.style={};this.events={};this.hidden=false;this.classes=new Set();this.captures=new Set();this.textContent='';this.classList={toggle:(n,b)=>{if(b)this.classes.add(n);else this.classes.delete(n)},remove:n=>this.classes.delete(n),add:n=>this.classes.add(n)};}
 addEventListener(n,f){(this.events[n]??=[]).push(f)}
 fire(n,e={}){for(const f of this.events[n]||[])f({preventDefault(){},button:0,...e})}
 setPointerCapture(id){this.captures.add(id)}
 hasPointerCapture(id){return this.captures.has(id)}
 releasePointerCapture(id){this.captures.delete(id)}
 getBoundingClientRect(){return{left:0,top:0,width:150,height:150}}
}
const nodes=new Map();const node=s=>{if(!nodes.has(s))nodes.set(s,new Node());return nodes.get(s)};
const radios=['cursor','joystick'].map(value=>Object.assign(new Node(),{value,checked:false}));
const storage=new Map();const canvas=new Node();
const context=vm.createContext({THREE,Math,console,$:node,innerWidth:900,innerHeight:500,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},document:{querySelectorAll:s=>s==='[name="flightControlMode"]'?radios:[]},playerPlane:'f86',weaponMode:'mg',player:null,keys:{up:false,down:false,left:false,right:false,fire:false,bomb:false,look:false},joystickInput:{x:0,y:0},filteredControlX:0,filteredControlY:0,gameMode:'duel',enemy:null,eHp:600,playing:true,camera:new THREE.PerspectiveCamera(63,1.8,.1,1400),renderer:{domElement:canvas},cameraDragPointer:null,cameraOrbitYaw:0,cameraOrbitPitch:0,cameraInputAt:-1,cameraPoseInitialized:false,worldTime:1,throttleValue:.78,updateThrottleUI(){},campaignTargets:()=>[],startEngineSound(){},clock:{getDelta(){}},toast(){}});
const declarations=['FLIGHT_CONTROL','AI_CONTROL','AIRCRAFT_SPECS','PROPELLER_SPECS','planeInfo','weaponInfo','METERS_PER_UNIT','CONTROL_SETTINGS_KEY','DEFAULT_CONTROL_SETTINGS'];
const functions=['loadControlSettings','controlModeName','saveControlSettings','renderControlSettings','applyControlModeUI','clearFlightInputs','resetCursorControl','changeControlMode','moveCursorDirection','updateCursorFlightControls','cursorViewQuaternion','availableCursorTargets','updateCursorTarget','playerGunReference','placeFlightMarker','updateFlightAimingHUD','resumeBattle','rotateAircraftLocal','rotateAircraftWorld','softLimitRate','shapeStickVector','flightControlAuthority','shapeControl','readFlightControls','updatePlayerFlightControls','turnRateForPlane','verticalTurnRateForPlane','steerAircraftToward','advanceAircraft','selectedWeaponIds','solveBulletIntercept','bindFlightControls'];
vm.runInContext(declarations.map(declaration).join('\n')+'\n'+functions.map(func).join('\n')+'\nlet controlSettings=loadControlSettings(),battlePaused=false,pausedEngineRunning=true,cursorDragPointer=null,cursorTarget=null,cursorCandidate=null,cursorCandidateSeconds=0,cursorOutsideSeconds=0;const cursorDirectionWorld=new THREE.Vector3(0,0,-1),flightPointerClearers=[];',context);
const run=x=>vm.runInContext(x,context);
function makePlane(type){
 const info=run(`planeInfo.${type}`),speed=info.maxSpeedKmh/3.6*.68,p=new THREE.Group();p.position.y=100;
 p.userData={type,lengthMeters:run(`AIRCRAFT_SPECS.${type}.lengthMeters`),throttle:.78,velocity:new THREE.Vector3(0,0,-speed/10),airspeed:speed,maxSpeedMps:info.maxSpeedKmh/3.6,minFlightSpeedMps:info.minLevelFlightKmh/3.6,bestClimbMps:info.bestClimbMps};return p
}
const results=[];
for(const type of ['i15bis','bf109b1','p36a','mig15','f86','meteor','b29']){
 context.playerPlane=type;context.player=makePlane(type);run('resetCursorControl();moveCursorDirection(100,-35);');
 const goal=run('cursorDirectionWorld.clone()'),nose0=new THREE.Vector3(0,0,-1),initialAngle=nose0.angleTo(goal);let maxRatio=0,largestSpeedStep=0;
 for(let i=0;i<600;i++){
  const priorSpeed=context.player.userData.airspeed;run('updatePlayerFlightControls(.02)');
  const d=context.player.userData;assert(Number.isFinite(d.airspeed)&&Number.isFinite(d.aoa));
  maxRatio=Math.max(maxRatio,Math.abs(d.turnRate)/run(`turnRateForPlane('${type}',${d.airspeed})`));
  largestSpeedStep=Math.max(largestSpeedStep,Math.abs(d.airspeed-priorSpeed));
 }
 const p=context.player,nose=new THREE.Vector3(0,0,-1).applyQuaternion(p.quaternion),endAngle=nose.angleTo(goal);
 assert(nose.x>0,`${type} did not turn right`);assert(nose.y>0,`${type} did not climb`);
 assert(endAngle<initialAngle*.7,`${type}: instructor did not approach ring (${endAngle}/${initialAngle})`);
 // The limit is evaluated before the step's drag; allow 0.2% for the final-speed comparison.
 assert(maxRatio<=1.002,`${type}: exceeded turn-rate limit`);assert(largestSpeedStep<5,`${type}: velocity jumped`);
 const held=run('cursorDirectionWorld.clone()');run('updatePlayerFlightControls(.02)');assert(held.distanceTo(run('cursorDirectionWorld'))<1e-9,'Released direction changed');
 results.push({plane:type,initialErrorDeg:initialAngle*180/Math.PI,finalErrorDeg:endAngle*180/Math.PI,maxTurnRatio:maxRatio,maxSpeedStepMps:largestSpeedStep})
}
context.player=makePlane('i15bis');context.playerPlane='i15bis';run("changeControlMode('joystick')");context.joystickInput.x=1;
let roll=0;for(let i=0;i<200;i++){run('updatePlayerFlightControls(.02)');roll+=context.player.userData.bankRate*.02}
assert(roll>Math.PI*2,'Joystick lost its free roll');assert(!context.player.userData.flightAssist);
run("changeControlMode('cursor')");assert.equal(context.joystickInput.x,0);assert.equal(run('loadControlSettings().mode'),'cursor');
run("changeControlMode('joystick')");assert.equal(run('loadControlSettings().mode'),'joystick');
storage.set(run('CONTROL_SETTINGS_KEY'),'{bad');assert.equal(run('loadControlSettings().mode'),'cursor');storage.clear();
run("changeControlMode('cursor');bindFlightControls()");
context.player=makePlane('f86');context.playerPlane='f86';run('resetCursorControl()');
const goal0=run('cursorDirectionWorld.clone()');canvas.fire('pointerdown',{pointerId:1,clientX:350,clientY:190});assert(run('cursorDirectionWorld').distanceTo(goal0)<1e-9,'Touch-down snapped ring');
canvas.fire('pointermove',{pointerId:2,clientX:600,clientY:250});assert(run('cursorDirectionWorld').distanceTo(goal0)<1e-9,'Wrong finger took direction');
canvas.fire('pointermove',{pointerId:1,clientX:430,clientY:170});assert(run('cursorDirectionWorld.x')>0&&run('cursorDirectionWorld.y')>0);
const held=run('cursorDirectionWorld.clone()');canvas.fire('pointercancel',{pointerId:1});canvas.fire('pointermove',{pointerId:1,clientX:600,clientY:210});assert(run('cursorDirectionWorld').distanceTo(held)<1e-9);
context.keys.look=true;canvas.fire('pointerdown',{pointerId:3,clientX:100,clientY:100});canvas.fire('pointermove',{pointerId:3,clientX:160,clientY:140});assert.notEqual(context.cameraOrbitYaw,0);assert(run('cursorDirectionWorld').distanceTo(held)<1e-9,'Free look changed heading');
node('#throttleTrack').fire('pointerdown',{pointerId:4,clientY:30});assert(context.throttleValue>.7);assert(run('cursorDirectionWorld').distanceTo(held)<1e-9,'Throttle changed heading');
run('clearFlightInputs()');assert.equal(context.keys.look,false);assert.equal(run('cursorDragPointer'),null);assert.equal(context.cameraDragPointer,null);
context.enemy=makePlane('mig15');context.enemy.position.copy(context.player.position).add(new THREE.Vector3(0,0,-50));context.enemy.userData.velocity.set(8,0,0);run('resetCursorControl()');
for(let i=0;i<25;i++)run('updateCursorTarget(.02)');assert.equal(run('cursorTarget'),context.enemy);
context.keys.fire=false;run('updateCursorTarget(.02)');assert.equal(run('cursorTarget'),context.enemy,'Fire release lost lock');
const gun=run('playerGunReference()'),solution=run('solveBulletIntercept(playerGunReference().origin,enemy.position,enemy.userData.velocity,playerGunReference().spec.speed/METERS_PER_UNIT)');assert(solution);
const bulletPoint=gun.origin.clone().addScaledVector(solution.direction,gun.spec.speed/10*solution.seconds),targetPoint=context.enemy.position.clone().addScaledVector(context.enemy.userData.velocity,solution.seconds);assert(bulletPoint.distanceTo(targetPoint)<1e-7,'Lead does not meet actual straight bullet');
context.enemy.position.set(0,100,-10000);run('updateFlightAimingHUD()');assert.equal(node('#leadIndicator').style.display,'none');
context.enemy=null;run('updateCursorTarget(.02)');assert.equal(run('cursorTarget'),null,'Dead target held');
vm.runInContext(func('updateChaseCamera')+'\n'+func('updateAimingReticle'),context);
context.cameraPoseInitialized=false;context.cameraOrbitYaw=0;context.cameraOrbitPitch=0;context.cameraInputAt=-1;
run('resetCursorControl();moveCursorDirection(100,-35);updateChaseCamera(.02)');
assert.equal(node('#reticle').style.display,'block');assert.equal(node('#aimCursor').style.display,'block');
assert(Math.abs(parseFloat(node('#reticle').style.left)-parseFloat(node('#aimCursor').style.left))>5,'Gunsight snapped to command ring');
for(let i=0;i<600;i++)run('updatePlayerFlightControls(.02);updateChaseCamera(.02)');
assert(Math.abs(parseFloat(node('#reticle').style.left)-parseFloat(node('#aimCursor').style.left))<5,'Gunsight failed to follow actual turn');
run('battlePaused=true;pausedEngineRunning=true;');context.playing=false;context.ended=false;context.player.userData.engineRunning=false;context.player.position.set(12,90,27);context.hp=321;context.kills=2;run('resumeBattle()');assert(context.playing&&context.player.userData.engineRunning);assert.equal(context.hp,321);assert.equal(context.kills,2);assert.deepEqual(context.player.position.toArray(),[12,90,27]);
const ids=[...html.split('<script type="module">')[0].matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(ids.length,new Set(ids).size,'Duplicate element ID');
for(const id of ['settings','openSettings','settingsHome','homeControlMode','cursorSensitivity','aimCursor','leadIndicator','freeLook'])assert(ids.includes(id),id);
const out={method:'Actual shipped Three.js and game functions in Node VM; DOM/camera/physics checks, not Android runtime',flight:results,otherChecks:['persistent modes and malformed settings','free joystick roll preserved','touch-down without snap','pointer ownership and cancellation','free look independence','throttle independence','locked target survives fire release','lead matches actual straight non-inherited projectiles','out-of-range lead hidden','destroyed target invalidated','commanded direction and real gunsight remain separate until the aircraft turns','pause resume retains health, kills and position','unique HTML IDs']};
fs.writeFileSync(new URL('./control-test-results.json',import.meta.url),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
