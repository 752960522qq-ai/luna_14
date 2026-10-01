import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as THREE from '../app/src/main/assets/three.module.js';

const source=fs.readFileSync(new URL('../game.mjs',import.meta.url),'utf8');
function declaration(name){
 const start=source.indexOf('const '+name+'=');assert(start>=0,name);
 let i=source.indexOf('=',start)+1,depth=0,quote='',escaped=false;
 for(;i<source.length;i++){
  const ch=source[i];
  if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote='';continue}
  if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue}
  if(ch==='{'||ch==='['||ch==='(')depth++;
  if(ch==='}'||ch===']'||ch===')')depth--;
  if(ch===';'&&depth===0)return source.slice(start,i+1);
 }
 throw Error('Unclosed declaration: '+name);
}
function func(name){
 const start=source.indexOf('function '+name+'(');assert(start>=0,name);
 let argumentEnd=source.indexOf('(',start),argumentDepth=1;
 while(argumentDepth){argumentEnd++;if(source[argumentEnd]==='(')argumentDepth++;else if(source[argumentEnd]===')')argumentDepth--}
 let end=source.indexOf('{',argumentEnd),depth=1;
 while(depth){end++;assert(end<source.length,name);if(source[end]==='{')depth++;else if(source[end]==='}')depth--}
 return source.slice(start,end+1);
}
const declarations=['FLIGHT_PHYSICS','DUEL_BOUNDARY_RULES','MAP_LIBRARY','METERS_PER_UNIT','FLIGHT_CONTROL','AI_CONTROL','AIRCRAFT_SPECS','PROPELLER_SPECS','planeInfo','weaponInfo','AI_TACTICS','AI_FIGHTER','AI_DUEL_CENTER','BOMBER_LOADOUTS'];
const functions=["moveCursorDirection", "limitedPitchRate", "instructorDirection", "steerAircraftToward", "integrateAircraftFlight", "advanceAircraft", "updateCursorFlightControls", "updatePlayerFlightControls", "recoverAircraftAttitude", "cursorChaseQuaternion", "updateCursorTarget", "updateFlightAimingHUD", "terrainBattleBounds", "outsideTerrainMeters", "duelBoundaryReturnGoal", "enforceDuelAIBoundary", "resetDuelBoundary", "updateDuelBoundary"].concat(['aircraft','updatePropeller','rotateAircraftLocal','rotateAircraftWorld','softLimitRate','shapeStickVector','flightControlAuthority','shapeControl','readFlightControls','updatePlayerFlightControls','updateCursorFlightControls','moveCursorDirection','turnRateForPlane','verticalTurnRateForPlane','steerAircraftToward','advanceAircraft','initializeFighterAI','changeAIState','muzzleWorldPoint','solveBulletIntercept','terrainLineClear','safeAIGoal','chooseAIBreakPoint','aiFormationGoal','decideFighterAI','aiFireIntent','recoverAircraftAttitude','updateFighterAI','selectedWeaponIds','freshAmmo','gunSoundFor','fireWeapons','releaseBullet']);
const code=declarations.map(declaration).concat([...new Set(functions)].map(func)).join('\n');
function makeContext(throttle=.78){
 const nodes=new Map(),nodeFor=s=>{if(!nodes.has(s)){const classes=new Set();nodes.set(s,{textContent:'',style:{},classList:{toggle(n,b){b?classes.add(n):classes.delete(n)},add(n){classes.add(n)},remove(n){classes.delete(n)},contains(n){return classes.has(n)}},setAttribute(){}})}return nodes.get(s)};
 const ctx=vm.createContext({THREE,Math,console,throttleValue:throttle,player:null,playerPlane:'bf109b1',enemy:null,enemyPlaneType:'i15bis',enemyWeaponMode:'mg',enemyAmmo:{mg:3050},enemyWeaponCooldowns:{mg:0,m2:0,mg762:0,n37:0,ns23:0,hispano:0},gameMode:'duel',activeMapId:'openSea',worldTime:0,terrainHeightAt:()=>-90,loadPlaneModel:()=>new Promise(()=>{}),attachPropeller(){},scene:{add(){},remove(){}},playSfx(){},updateAmmoUI(){},bullets:[],bulletPool:[],bulletResources:{},controlSettings:{mode:'cursor',sensitivity:1},keys:{up:false,down:false,left:false,right:false,fire:false,look:false},joystickInput:{x:0,y:0},filteredControlX:0,filteredControlY:0,innerWidth:900,innerHeight:500,camera:{fov:63},playing:true,hp:600,eHp:600,finish(){},updateHealthUI(){},toast(){},$:nodeFor});
 vm.runInContext(code+'\nlet koreaTerrainBounds=null,duelDesertionRemaining=null;const cursorDirectionWorld=new THREE.Vector3(0,0,-1);',ctx);
 const run=s=>vm.runInContext(s,ctx);
 return{ctx,run,nodes};
}

const base=makeContext(),info=base.run('planeInfo'),propSpecs=base.run('PROPELLER_SPECS');
function plane(h,type,isPlayer=true,position=new THREE.Vector3(0,60,0),warm=false){
 h.ctx.testType=type;h.ctx.testIsPlayer=isPlayer;
 const root=h.run('aircraft(testIsPlayer,testType)');root.position.copy(position);root.userData.engineRunning=true;
 if(warm){const p=propSpecs[type];if(p)root.userData.propRpm=p.idleRpm+(p.maxRpm-p.idleRpm)*root.userData.throttle}
 return root;
}
function setDirection(h,direction){h.ctx.direction=direction;h.run('cursorDirectionWorld.copy(direction).normalize()')}
function playerStep(h,dt){h.run(`updatePlayerFlightControls(${dt})`)}
function propStep(h,roots,dt){for(const root of roots){h.ctx.currentRoot=root;h.run(`updatePropeller(currentRoot,${dt})`)}}


export {THREE,makeContext,info,propSpecs,plane,setDirection,playerStep,propStep,declaration,func,source};
