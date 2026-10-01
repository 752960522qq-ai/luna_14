import fs from 'node:fs';
import assert from 'node:assert/strict';
import {run,dir} from './case-runner.mjs';
import {info} from './runtime.mjs';

const cases=[];
for(const type of Object.keys(info))for(const fps of [30,60,120]){
 const r=run({id:`${type}-rolling-pull-${fps}`,type,fps,throttle:1,speedKmh:info[type].maxSpeedKmh*.75,mode:'joystick',duration:25,inputAt:t=>({x:Math.sin(t*.8),y:.65*Math.cos(t*.35)})},()=>dir());
 assert(r.maxAoADeg<22,`${r.id} high AoA ${r.maxAoADeg}`);cases.push(r)
}
fs.writeFileSync(new URL('rolling-pull-v11.json',import.meta.url),JSON.stringify({method:'Actual generated v11 flight functions; sinusoidal joystick roll/pitch, synthetic initial conditions',result:'passed',cases},null,2));
console.log(JSON.stringify({cases:cases.length,maxAoADeg:Math.max(...cases.map(x=>x.maxAoADeg)),result:'passed'}));
