import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {THREE,makeContext,info,plane,propStep,func,source} from './runtime.mjs';

const report={method:'Actual v11 flight/AI/boundary functions, shipped Three.js; real-time simulation steps, flat mock ground for boundary isolation.',ai:[],countdown:[],other:[]};
const F=new THREE.Vector3(0,0,-1),fps=30,dt=1/fps;
for(const map of ['openSea','korea1951'])for(const type of Object.keys(info))for(const edge of ['east','west','north','south','ne','nw','se','sw','center']){
 const h=makeContext(1);h.ctx.activeMapId=map;h.ctx.terrainHeightAt=()=>-90;
 vm.runInContext(func('updateDuelEnemy'),h.ctx);h.ctx.damage=()=>{};
 const b=h.run('terrainBattleBounds()'),e=plane(h,type,false,new THREE.Vector3(0,200,0),true),p=plane(h,'mig15',true,new THREE.Vector3(0,200,-100),true);
 h.ctx.enemy=e;h.ctx.enemyPlaneType=type;h.ctx.player=p;h.ctx.playerPlane='mig15';h.ctx.enemyAmmo=type==='b29'?{}:h.run(`freshAmmo('${type}')`);h.ctx.enemyWeaponMode=type==='mig15'?'both':type==='meteor'?'hispano':'mg';
 if(type==='b29')e.userData.patrolPhase=0;else h.run("initializeFighterAI(enemy,'duel',0)");
 const side=new THREE.Vector3(['east','ne','se'].includes(edge)?1:['west','nw','sw'].includes(edge)?-1:0,0,['north','ne','nw'].includes(edge)?-1:['south','se','sw'].includes(edge)?1:0).normalize();
 if(side.x)e.position.x=side.x>0?b.maxX-.5:b.minX+.5;if(side.z)e.position.z=side.z>0?b.maxZ-.5:b.minZ+.5;
 if(edge!=='center'){e.quaternion.setFromUnitVectors(F,side);e.userData.velocity.copy(side).multiplyScalar(info[type].maxSpeedKmh*.9/36);e.userData.airspeed=e.userData.velocity.length()*10;p.position.copy(e.position).addScaledVector(side,80)}
 const duration=edge==='center'?180:type==='b29'?90:45;h.run('const originalBoundaryConstraint=enforceDuelAIBoundary;let hardContacts=0;enforceDuelAIBoundary=function(root){if(root&&outsideTerrainMeters(root.position)>DUEL_BOUNDARY_RULES.aiMarginMeters+1e-7)hardContacts++;originalBoundaryConstraint(root)}');
 let maxOutside=0,maxAoA=0,returnAt=null,minKmh=Infinity;
 for(let k=1;k<=duration*fps;k++){
  const t=k*dt;h.ctx.worldTime=t;
  if(edge==='center'){
   const angle=t*.04,pad=t<90?.8:1.12;p.position.set(Math.cos(angle)*b.maxX*pad,140+30*Math.sin(t*.03),Math.sin(angle)*b.maxZ*pad);p.userData.velocity.set(-Math.sin(angle)*b.maxX*pad*.04,.9*Math.cos(t*.03),Math.cos(angle)*b.maxZ*pad*.04);
  }
  h.run(`updateDuelEnemy(${dt});while(bullets.length)releaseBullet(bullets.length-1)`);propStep(h,[e],dt);
  const outside=h.run('outsideTerrainMeters(enemy.position)');maxOutside=Math.max(maxOutside,outside);maxAoA=Math.max(maxAoA,Math.abs(e.userData.aoa||0)*180/Math.PI);minKmh=Math.min(minKmh,e.userData.airspeed*3.6);
  assert(outside<=100+1e-6,`${map}/${type}/${edge} escaped ${outside}`);assert(Number.isFinite(e.userData.airspeed)&&Math.abs(e.quaternion.length()-1)<1e-6,'Unstable aircraft state');
  if(edge!=='center'&&t>2&&outside<.01&&e.position.x>b.minX+2&&e.position.x<b.maxX-2&&e.position.z>b.minZ+2&&e.position.z<b.maxZ-2&&returnAt===null)returnAt=t;
 }
 if(edge!=='center')assert(returnAt!==null,`${map}/${type}/${edge} failed to return from boundary`);
 report.ai.push({map,type,edge,durationSeconds:duration,maxOutsideMeters:maxOutside,hardContacts:h.run('hardContacts'),returnAtSeconds:returnAt,minKmh,maxAoADeg:maxAoA});
}
// Count down using active wall time, cancel on return, freeze while paused.
for(const map of ['openSea','korea1951'])for(const rate of [30,60,120]){
 const h=makeContext(1);h.ctx.activeMapId=map;h.ctx.player=plane(h,'mig15');const b=h.run('terrainBattleBounds()');h.ctx.player.position.x=b.maxX+30.01;
 h.ctx.finish=win=>{h.ctx.playing=false;h.ctx.ended=true;h.run('resetDuelBoundary()');assert.equal(win,false)};
 for(let k=0;k<rate*14;k++)h.run(`updateDuelBoundary(${1/rate})`);
 assert(h.ctx.playing&&h.ctx.hp>0,'Early self destruction');assert(Math.abs(h.run('duelDesertionRemaining')-1)<1e-8,'Not elapsed time');
 h.ctx.playing=false;h.run('updateDuelBoundary(300)');assert(Math.abs(h.run('duelDesertionRemaining')-1)<1e-8,'Pause drained countdown');h.ctx.playing=true;
 h.ctx.player.position.x=b.maxX+30;h.run('updateDuelBoundary(.01)');assert.equal(h.run('duelDesertionRemaining'),null,'300 m must be safe');assert(h.nodes.get('#boundaryWarning').classList.contains('hidden'));
 h.ctx.player.position.x=b.maxX+31;h.run('updateDuelBoundary(1)');assert.equal(h.run('duelDesertionRemaining'),14,'Reentry did not reset 15 seconds');
 h.run('updateDuelBoundary(13.5)');assert(h.ctx.playing);h.run('updateDuelBoundary(.5)');assert.equal(h.ctx.hp,0);assert(h.ctx.player.userData.desertionDestroyed&&h.ctx.ended);assert.equal(h.nodes.get('#resultTitle').textContent,'临阵脱逃');
 report.countdown.push({map,fps:rate,activeSecondsToDestruct:15,pauseFreeze:true,returnCancels:true,reentryRestarts:true});
}
{
 const h=makeContext();h.ctx.activeMapId='korea1951';h.ctx.player=plane(h,'bf109b1');h.ctx.enemy=plane(h,'i15bis',false);h.ctx.player.position.set(1000,100,1000);h.ctx.enemy.position.copy(h.ctx.player.position);h.ctx.gameMode='campaign';h.run('updateDuelBoundary(1000);enforceDuelAIBoundary(enemy)');assert.equal(h.ctx.hp,600);assert.equal(h.ctx.enemy.position.x,1000);assert.equal(h.run('duelDesertionRemaining'),null);report.other.push('Campaign excluded');
 h.ctx.gameMode='duel';h.ctx.enemy.position.set(307,100,307);h.ctx.enemy.userData.velocity.set(10,2,-5);const prior=h.ctx.enemy.userData.velocity.length();h.run('enforceDuelAIBoundary(enemy)');assert(h.run('outsideTerrainMeters(enemy.position)')<=100+1e-8);assert(h.ctx.enemy.userData.velocity.length()<=prior+1e-8);assert.equal(h.ctx.enemy.position.y,100);report.other.push('Rounded corner uses distance; altitude and tangential speed preserved');
}
// Exercise the loader's real scaling/centering and derive a non-square coverage.
{
 const h=makeContext(),terrain=new THREE.Group();terrain.add(new THREE.Mesh(new THREE.BoxGeometry(400,100,200)));terrain.position.set(42,12,21);h.ctx.planeModelLoader={loadAsync:async()=>({scene:terrain})};h.run('let koreaTerrainPromise=null,koreaTerrain=null;');vm.runInContext(func('loadKoreaTerrain'),h.ctx);await h.run('loadKoreaTerrain()');h.ctx.activeMapId='korea1951';const b=h.run('terrainBattleBounds()');assert(Math.abs(b.maxX-b.minX-600)<1e-6);assert(Math.abs(b.maxZ-b.minZ-300)<1e-6);h.ctx.player=plane(h,'mig15');h.ctx.player.position.z=b.maxZ+30;assert(Math.abs(h.run('outsideTerrainMeters(player.position)')-300)<1e-6);report.other.push('Terrain loader derives actual scaled XZ extent, including non-square coverage');
}
assert(source.includes('if(playing)updateDuelBoundary(elapsed)'),'Countdown not connected to active animation elapsed time');
assert(source.includes('if(document.hidden&&playing)window.showPause()'),'Background does not pause');
fs.writeFileSync(new URL('boundary-v11.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({result:'passed',aiCases:report.ai.length,simulatedSeconds:report.ai.reduce((s,x)=>s+x.durationSeconds,0),maxOutsideMeters:Math.max(...report.ai.map(x=>x.maxOutsideMeters)),centerCasesWithHardContacts:report.ai.filter(x=>x.edge==='center'&&x.hardContacts>0),countdownCases:report.countdown.length,other:report.other},null,2));
