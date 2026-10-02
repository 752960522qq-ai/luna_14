import fs from 'node:fs';
import assert from 'node:assert/strict';
import {THREE,makeContext,info,plane,setDirection,playerStep,propStep} from './runtime.mjs';
import {run,dir,setup,series,R,F} from './case-runner.mjs';

const report={method:'Actual generated v11 functions and packaged Three.js; synthetic inputs, not phone/video replay.',input:[],flight:[],fps:[],manual:[],speed:[],climbContinuity:[]};
// Reproduce the old pole reflection using one large event versus split events.
for(const pitch of [-75,-70,0,70,75])for(const dy of [-100,100]){
 const h=makeContext(1);h.ctx.player=plane(h,'mig15');setDirection(h,dir(0,pitch));h.run(`moveCursorDirection(0,${dy})`);const one=h.run('cursorDirectionWorld.clone()');
 setDirection(h,dir(0,pitch));h.run(`moveCursorDirection(0,${dy/2});moveCursorDirection(0,${dy/2})`);const split=h.run('cursorDirectionWorld.clone()');
 assert(one.distanceTo(split)<1e-8,'Input packet sizes changed direction');assert(one.z<0,'Vertical drag reversed horizontal heading');
 report.input.push({pitch,dy,differenceDeg:one.angleTo(split)/R,resultPitch:Math.asin(one.y)/R});
}
for(const type of Object.keys(info)){
 for(const [name,yaw,pitch,bank,duration] of [['horizontal',90,0,0,30],['pitch',0,45,0,30],['bank90',0,15,90,20],['inverted',0,15,180,20],['turn-dive',120,-60,0,35]]){
  const moving=name==='turn-dive',testDuration=type==='b29'&&moving?70:duration,r=run({id:`${type}-${name}`,type,throttle:1,speedKmh:info[type].maxSpeedKmh*.75,bank,duration:testDuration},t=>dir(yaw*(moving?Math.min(t/3,1):1),pitch*(moving?Math.min(t/3,1):1)));
  assert(r.maxAoADeg<22,`${r.id} exceeded instructor AoA protection: ${r.maxAoADeg}`);
  if(name!=='pitch')assert(r.final.goalErrorDeg<10,`${r.id} failed to approach commanded direction: ${r.final.goalErrorDeg}`);
  // A fast, large command can legitimately outrun a bomber's attitude response.
  // Reject sustained wrong-direction behavior after settling, not initial command lag.
  if(name!=='pitch')assert(r.lastHalfMeanErrorDeg<10,`${r.id} sustained wrong-direction response`);report.flight.push(r);
 }
 const rollDuration=type==='b29'?25:10,r=run({id:`${type}-manual-roll`,type,throttle:1,speedKmh:info[type].maxSpeedKmh*.75,mode:'joystick',duration:rollDuration,inputAt:()=>({x:1,y:0})},()=>dir());
 const rows=series.filter(x=>x.scenario===r.id);let totalRoll=0;for(let k=1;k<rows.length;k++)totalRoll+=rows[k].localRollRateDps*(rows[k].t-rows[k-1].t);
 assert(totalRoll>360,`${type} cannot complete free roll`);assert(r.maxAoADeg<20,`${type} manual roll high AoA`);report.manual.push({...r,totalRollDeg:totalRoll});
 const {h,p}=setup(type,1,info[type].maxSpeedKmh*.75);setDirection(h,dir());for(let k=0;k<60*90;k++){playerStep(h,1/60);propStep(h,[p],1/60)}
 report.speed.push({type,throttle:1,levelKmh:p.userData.airspeed*3.6,configuredMaxKmh:info[type].maxSpeedKmh});
 assert(p.userData.airspeed*3.6<=info[type].maxSpeedKmh*1.01,'Level overspeed');
}
assert(report.speed.find(x=>x.type==='bf109b1').levelKmh>report.speed.find(x=>x.type==='i15bis').levelKmh+40,'Bf 109 cannot outrun I-15 at equal power');
for(const fps of [30,60,120]){
 const r=run({id:`mig15-fps-${fps}`,type:'mig15',throttle:.78,speedKmh:500,duration:35,fps},t=>dir(120*Math.min(t/3,1),-60*Math.min(t/3,1)));
 assert(r.final.goalErrorDeg<1&&r.maxAoADeg<10,`FPS ${fps} failed`);report.fps.push(r);
}
assert(Math.max(...report.fps.map(x=>x.final.speedKmh))-Math.min(...report.fps.map(x=>x.final.speedKmh))<2,'FPS changed speed substantially');
for(const pitch of [29,30,31])report.climbContinuity.push(run({id:`bf109b1-climb-${pitch}`,type:'bf109b1',throttle:1,speedKmh:450,duration:12},()=>dir(0,pitch)));
assert(Math.max(...report.climbContinuity.map(x=>x.final.speedKmh))-Math.min(...report.climbContinuity.map(x=>x.final.speedKmh))<25,'30-degree climb discontinuity remains');
const h=makeContext(1),p=plane(h,'bf109b1');h.ctx.player=p;p.userData.airspeed=p.userData.minFlightSpeedMps;h.ctx.wanted=dir(0,75);h.run('instructorDirection(player,wanted,.02)');assert(p.userData.instructorEnergyGuard,'Low speed climb guard absent');
fs.writeFileSync(new URL('flight-regression-v13.json',import.meta.url),JSON.stringify(report,null,2));
const columns=Object.keys(series[0]);fs.writeFileSync(new URL('flight-series-v13.csv',import.meta.url),columns.join(',')+'\n'+series.map(r=>columns.map(c=>r[c]??'').join(',')).join('\n')+'\n');
console.log(JSON.stringify({input:report.input.length,flight:report.flight.length,manual:report.manual.length,fps:report.fps.length,speed:report.speed,climb:report.climbContinuity.map(x=>({id:x.id,speed:x.final.speedKmh})),result:'passed'},null,2));
