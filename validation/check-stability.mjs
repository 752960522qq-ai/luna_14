import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadGame} from './screen-runtime.mjs';
const near=(a,b,e=1e-7)=>assert(Math.abs(a-b)<e,`${a} != ${b}`);
function random(){let s=21878;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296}}
function setup(mode='cursor'){
 const h=loadGame({random:random()});h.run(`gameMode='campaign';reset();controlSettings.mode='${mode}';resetCursorControl()`);return h
}
const camera=[],physics=[],ceiling=[],interpolation=[];
for(const mode of ['cursor','joystick']){
 const h=setup(mode);h.run(`player.position.set(0,60,0);player.quaternion.identity();resetCursorControl();resetCameraTracking();updateChaseCamera(0);globalThis.stepCamera=dt=>{player.position.z-=25*dt;updateChaseCamera(dt);return camera.position.clone().sub(player.position).multiplyScalar(10).toArray()}`);
 for(let i=0;i<240;i++)h.context.stepCamera(1/60);
 for(const dt of [1/120,1/60,1/30,.05,.1,.2]){
  const offset=h.context.stepCamera(dt);const expected=h.run('chaseFrameOffsets(playerPlane)');near(offset[1],expected.heightMeters);near(offset[2],expected.backMeters);camera.push({mode,dt,offset})
 }
 function trial(tail){const x=setup(mode);for(let i=0;i<120;i++)x.advance(1/60);for(const dt of tail)x.advance(dt);return x.run(`({position:player.position.toArray(),camera:camera.position.toArray(),speed:player.userData.airspeed,campaignElapsed,worldTime,pending:battleSimulationAccumulator})`)}
 for(const [milliseconds,frames] of [[100,6],[200,12]]){
  const normal=trial(Array(frames).fill(1/60)),spike=trial([milliseconds/1000]);
  for(let k=0;k<3;k++){near(normal.position[k],spike.position[k]);near(normal.camera[k],spike.camera[k])}
  near(normal.speed,spike.speed);near(normal.campaignElapsed,spike.campaignElapsed);near(spike.worldTime,2+milliseconds/1000);
  physics.push({mode,milliseconds,normal,spike})
 }
 const debt=setup(mode);debt.advance(.8);near(debt.run('campaignElapsed'),.4);near(debt.run('battleSimulationAccumulator'),.4);debt.advance(0);near(debt.run('campaignElapsed'),.8);near(debt.run('battleSimulationAccumulator'),0);
 const frozen=debt.run('campaignElapsed');debt.window.showPause();debt.advance(10);near(debt.run('campaignElapsed'),frozen);debt.find('#again').fire('click');debt.advance(1/60);near(debt.run('campaignElapsed'),frozen+1/60);
}
// Rendering interpolates the fixed simulation snapshots and restores exact collision state.
{
 const h=setup();h.run(`player.userData.renderPreviousPosition=new THREE.Vector3(0,50,10);player.userData.renderPreviousQuaternion=new THREE.Quaternion();player.position.set(0,50,8);battleSimulationAccumulator=BATTLE_TIMING.stepSeconds*.5;applyBattleRenderPose()`);
 near(h.run('player.position.z'),9);h.run('restoreBattlePhysicsPose()');near(h.run('player.position.z'),8);
 interpolation.push({halfStepPositionZ:9,restoredPhysicsZ:8});
 h.run(`gameMode='airspace';selectedAircraft='i15';reset();player.userData.renderPreviousPosition=player.position.clone().add(new THREE.Vector3(0,0,2));player.userData.renderPreviousQuaternion=player.quaternion.clone();airspaceAccumulator=AIRSPACE_RULES.stepSeconds*.5;testZ=player.position.z;applyBattleRenderPose()`);
 near(h.run('player.position.z-testZ'),1);h.run('restoreBattlePhysicsPose()');near(h.run('player.position.z-testZ'),0)
}
// Every AI airframe obeys 3000m MSL, including recovery and a target above the ceiling.
for(const type of ['i16','i15','i15bis','mig3','f3f2','p36a','bf109b1','mig15','f86','meteor','b29']){
 const h=setup();h.context.testType=type;
 h.run(`testAI=aircraft(false,testType);testAI.position.set(0,209.9,0);testAI.userData.engineRunning=true;testAI.userData.throttle=1;testAI.userData.propRpm=1900;testAI.userData.velocity.set(0,8,-testAI.userData.maxSpeedMps/10);testAI.userData.airspeed=testAI.userData.velocity.length()*10;testGoal=new THREE.Vector3(0,600,-100);safeGoal=safeAIGoal(testAI,testGoal);`);
 assert(h.run('safeGoal.y')<=205);let max=-Infinity;
 for(let i=0;i<1200;i++){h.run('steerAircraftToward(testAI,testGoal.clone().sub(testAI.position),1/120);advanceAircraft(testAI,1/120)');max=Math.max(max,h.run('(testAI.position.y+90)*10'))}
 assert(max<=3000+1e-7,type);ceiling.push({type,maxAltitudeMeters:max,finalAltitudeMeters:h.run('(testAI.position.y+90)*10')});
 h.run('player.position.set(0,220,0);player.userData.velocity.set(0,0,-20);advanceAircraft(player,1/120)');assert(h.run('player.position.y')>210,'Player was incorrectly capped');
}
const report={result:'passed',checks:['Same calibrated camera offset across regular and 50/100/200ms intervals in cursor and joystick modes','Actual campaign position, velocity, clock and camera agree for equal elapsed time at 100ms and 200ms','A .8s interval retains .4s debt after the 48-step budget and catches it up next frame without dropping time','Pause excludes inactive wall time; resume preserves the live sortie','Aircraft rendering interpolates between physics snapshots and restores exact transforms before the next collision step','All eleven AI airframes stay at or below 3000m MSL, while the player remains unrestricted'],camera,physics,interpolation,ceiling};
fs.writeFileSync(new URL('stability-v20.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
