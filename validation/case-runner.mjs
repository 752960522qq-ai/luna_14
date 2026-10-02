import fs from 'node:fs';
import assert from 'node:assert/strict';
import {THREE,makeContext,info,plane,setDirection,playerStep,propStep} from './runtime.mjs';

const D=180/Math.PI,R=Math.PI/180,Y=new THREE.Vector3(0,1,0),X=new THREE.Vector3(1,0,0),F=new THREE.Vector3(0,0,-1);
const results={method:'Generated v11 game functions and shipped Three.js in Node VM. Synthetic controls and initial conditions; not video input replay or phone FPS measurement.',parameters:info,steps:[],initialBank:[],turns:[],pitch:[],sequences:[],frameRate:[],joystick:[],localPitchCheck:[]},series=[];
function dir(yaw=0,pitch=0){return F.clone().applyAxisAngle(X,pitch*R).applyAxisAngle(Y,yaw*R)}
function setup(type,throttle=.78,speedKmh=null,bank=0,pitch=0){
 const h=makeContext(throttle),p=plane(h,type,true,new THREE.Vector3(0,1000,0),true);h.ctx.player=p;h.ctx.playerPlane=type;
 if(speedKmh===null){for(let i=0;i<1800;i++){playerStep(h,1/60);propStep(h,[p],1/60)}}
 const speed=speedKmh===null?p.userData.airspeed*3.6:speedKmh;
 p.quaternion.setFromAxisAngle(X,pitch*R).multiply(new THREE.Quaternion().setFromAxisAngle(F,bank*R));
 p.userData.velocity.copy(F).applyQuaternion(p.quaternion).multiplyScalar(speed/36);p.userData.airspeed=speed/3.6;
 p.userData.aoa=0;p.userData.sideslip=0;p.userData.aiRollRate=0;p.userData.aiPitchRate=0;
 setDirection(h,dir(0,pitch));return {h,p};
}
function signedAngle(a,b){return Math.atan2(new THREE.Vector3().crossVectors(a,b).y,a.dot(b))*D}
function snap(id,t,p,target,prev=null,dt=1/60){
 const d=p.userData,nose=F.clone().applyQuaternion(p.quaternion),up=Y.clone().applyQuaternion(p.quaternion),travel=d.velocity.clone().normalize(),nf=nose.clone().setY(0),vf=travel.clone().setY(0),horizon=Y.clone().addScaledVector(nose,-nose.y).normalize(),right=new THREE.Vector3().crossVectors(nose,horizon).normalize();
 const row={scenario:id,t,speedKmh:d.airspeed*3.6,goalErrorDeg:nose.angleTo(target)*D,noseVelocityDeg:nose.angleTo(travel)*D,aoaDeg:(d.aoa||0)*D,slipDeg:(d.sideslip||0)*D,nosePitchDeg:Math.asin(THREE.MathUtils.clamp(nose.y,-1,1))*D,velocityPitchDeg:Math.asin(THREE.MathUtils.clamp(travel.y,-1,1))*D,bankDeg:Math.atan2(up.dot(right),up.dot(horizon))*D,localPitchRateDps:(d.aiPitchRate||d.verticalTurnRate||0)*D,localRollRateDps:(d.aiRollRate||d.bankRate||0)*D,wingTurnDps:(d.turnRate||0)*D,altitudeM:p.position.y*10,verticalMps:d.velocity.y*10,noseX:nose.x,noseY:nose.y,noseZ:nose.z,targetX:target.x,targetY:target.y,targetZ:target.z,travelX:travel.x,travelY:travel.y,travelZ:travel.z,worldYawRateDps:prev&&nf.lengthSq()>1e-6&&prev.nf.lengthSq()>1e-6?signedAngle(prev.nf,nf)/dt:null,flightPathYawRateDps:prev&&vf.lengthSq()>1e-6&&prev.vf.lengthSq()>1e-6?signedAngle(prev.vf,vf)/dt:null,flightPathPitchRateDps:prev?(Math.asin(THREE.MathUtils.clamp(travel.y,-1,1))*D-prev.velocityPitchDeg)/dt:null};
 assert(Object.values(row).every(v=>typeof v!=='number'||Number.isFinite(v)),id);return {row,prev:{nf,vf,velocityPitchDeg:row.velocityPitchDeg}};
}
function run(test,targetAt){
 const {id,type,throttle=.78,speedKmh=null,bank=0,initialPitch=0,duration=20,fps=60,mode='cursor',inputAt}=test,{h,p}=setup(type,throttle,speedKmh,bank,initialPitch),dt=1/fps;
 h.ctx.controlSettings.mode=mode;let prev=null,first10=null,first5=null,opposedAfter2=0,maxError=0,maxNoseVelocity=0,maxAoA=0,minSpeed=Infinity,sumLast=0,sumLag=0,n=0,totalLargeAoA=0,maxFlightYaw=0,maxFlightPitch=0;
 let target=targetAt(0),first=snap(id,0,p,target);series.push(first.row);prev=first.prev;
 for(let k=1;k<=duration*fps;k++){
  const t=k*dt;target=targetAt(t);setDirection(h,target);
  if(mode==='joystick'){const input=inputAt(t);h.ctx.joystickInput.x=input.x;h.ctx.joystickInput.y=input.y}
  playerStep(h,dt);propStep(h,[p],dt);const s=snap(id,t,p,target,prev,dt),r=s.row;prev=s.prev;
  if(r.goalErrorDeg<10&&first10===null)first10=t;if(r.goalErrorDeg<5&&first5===null)first5=t;
  if(t>2&&r.goalErrorDeg>90)opposedAfter2+=dt;
  maxError=Math.max(maxError,r.goalErrorDeg);maxNoseVelocity=Math.max(maxNoseVelocity,r.noseVelocityDeg);maxAoA=Math.max(maxAoA,Math.abs(r.aoaDeg));minSpeed=Math.min(minSpeed,r.speedKmh);
  if(Math.abs(r.aoaDeg)>32.086)totalLargeAoA+=dt;
  maxFlightYaw=Math.max(maxFlightYaw,Math.abs(r.flightPathYawRateDps||0));maxFlightPitch=Math.max(maxFlightPitch,Math.abs(r.flightPathPitchRateDps||0));
  if(t>duration/2){sumLast+=r.speedKmh;sumLag+=r.goalErrorDeg;n++}
  if(k%Math.max(1,Math.round(fps/10))===0||k===1)series.push(r);
 }
 const last=series.at(-1);return {...test,startingKmh:first.row.speedKmh,first10Seconds:first10,first5Seconds:first5,opposedAfter2Seconds:opposedAfter2,maxGoalErrorDeg:maxError,maxNoseVelocityDeg:maxNoseVelocity,maxAoADeg:maxAoA,largeAoASeconds:totalLargeAoA,minSpeedKmh:minSpeed,lastHalfMeanKmh:sumLast/n,lastHalfMeanErrorDeg:sumLag/n,maxFlightPathYawDps:maxFlightYaw,maxFlightPathPitchDps:maxFlightPitch,final:last};
}

export {results,series,dir,setup,run,snap,D,R,F,X,Y};
