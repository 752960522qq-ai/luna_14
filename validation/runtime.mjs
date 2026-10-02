import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as THREE from '../app/src/main/assets/three.module.js';
import {sourceIndex} from '../scripts/source-index.mjs';
import {bridgeState} from './state-bridge.mjs';

const source=fs.readFileSync(new URL('../game.mjs',import.meta.url),'utf8');
const index=sourceIndex(source);
const declaration=name=>index.declaration(name);
const func=name=>index.function(name);
const declarations=['AIRCRAFT_DATA','PROJECTILE_SMOKE_RULES','FLIGHT_AXES','FLIGHT_PHYSICS','DUEL_BOUNDARY_RULES','MAP_LIBRARY','METERS_PER_UNIT','FLIGHT_CONTROL','AI_CONTROL','AIRCRAFT_SPECS','PROPELLER_SPECS','planeInfo','weaponInfo','AI_TACTICS','AI_FIGHTER','AI_DUEL_CENTER','BOMBER_LOADOUTS'];
const functions=["moveCursorDirection", "limitedPitchRate", "instructorDirection", "steerAircraftToward", "integrateAircraftFlight", "advanceAircraft", "updateCursorFlightControls", "updatePlayerFlightControls", "recoverAircraftAttitude", "cursorChaseQuaternion", "updateCursorTarget", "updateFlightAimingHUD", "terrainBattleBounds", "outsideTerrainMeters", "duelBoundaryReturnGoal", "enforceDuelAIBoundary", "resetDuelBoundary", "updateDuelBoundary"].concat(['aircraft','updatePropeller','rotateAircraftLocal','rotateAircraftWorld','softLimitRate','shapeStickVector','flightControlAuthority','shapeControl','readFlightControls','updatePlayerFlightControls','updateCursorFlightControls','moveCursorDirection','turnRateForPlane','verticalTurnRateForPlane','steerAircraftToward','advanceAircraft','initializeFighterAI','changeAIState','muzzleWorldPoint','solveBulletIntercept','terrainLineClear','safeAIGoal','chooseAIBreakPoint','aiFormationGoal','decideFighterAI','aiFireIntent','recoverAircraftAttitude','updateFighterAI','selectedWeaponIds','freshAmmo','gunSoundFor','fireWeapons','releaseBullet']);
functions.push('recordShotCount','ensureProjectileSmoke','emitProjectileSmoke','startBulletSmoke','traceBulletSmoke','updateProjectileSmoke','clearProjectileSmoke','emitTurretSmoke','limitAICeilingDirection','enforceAICeiling','ensureBulletResources','flightWorkspace','aircraftCatalogueSpecs');
const code=declarations.map(declaration).concat([...new Set(functions.filter(n=>n!=='rotateAircraftWorld'))].map(func)).join('\n');
function makeContext(throttle=.78){
 const nodes=new Map(),nodeFor=s=>{if(!nodes.has(s)){const classes=new Set();nodes.set(s,{textContent:'',style:{},classList:{toggle(n,b){b?classes.add(n):classes.delete(n)},add(n){classes.add(n)},remove(n){classes.delete(n)},contains(n){return classes.has(n)}},setAttribute(){}})}return nodes.get(s)};
 const ctx=vm.createContext({THREE,Math,console,throttleValue:throttle,player:null,playerPlane:'bf109b1',enemy:null,enemyPlaneType:'i15bis',enemyWeaponMode:'mg',enemyAmmo:{mg:3050},enemyWeaponCooldowns:{mg:0,m2:0,mg762:0,n37:0,ns23:0,hispano:0},gameMode:'duel',activeMapId:'openSea',worldTime:0,terrainHeightAt:()=>-90,loadPlaneModel:()=>new Promise(()=>{}),attachPropeller(){},scene:{add(){},remove(){}},playSfx(){},updateAmmoUI(){},bullets:[],bulletPool:[],bulletResources:{},controlSettings:{mode:'cursor',sensitivity:1},keys:{up:false,down:false,left:false,right:false,fire:false,look:false},joystickInput:{x:0,y:0},filteredControlX:0,filteredControlY:0,innerWidth:900,innerHeight:500,camera:{fov:63},playing:true,hp:600,eHp:600,finish(){},updateHealthUI(){},toast(){},$:nodeFor});
 ctx.damage=()=>{ctx.hp=0;ctx.finish(false)};
 const run=s=>vm.runInContext(s,ctx);
 bridgeState(ctx,run,{seed:true});
 ctx.koreaTerrainBounds=null;ctx.duelDesertionRemaining=null;ctx.cursorDirectionWorld=new THREE.Vector3(0,0,-1);
 vm.runInContext(code,ctx);
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
