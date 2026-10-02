import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as THREE from './app/src/main/assets/three.module.js';
const s=fs.readFileSync(new URL('./app/src/main/assets/index.html',import.meta.url),'utf8');
const start=s.indexOf('function sweptAircraftHit('),end=s.indexOf('\nfunction rememberAircraftFrameStart',start);
const c=vm.createContext({THREE,Math});vm.runInContext(s.slice(start,end),c);
const box=new THREE.Group();box.userData.collisionHalfExtents=new THREE.Vector3(.5,.5,.5);c.box=box;
function hit(a,b,r=0){c.a=a;c.b=b;c.r=r;return vm.runInContext('sweptAircraftHit(a,b,box,r)',c)}
const results=[];
for(const fps of [30,60,120]){
 let p=new THREE.Vector3(0,0,1.4),found=false;
 for(let i=0;i<4;i++){const next=p.clone().add(new THREE.Vector3(0,0,-94.5/fps));if(hit(p,next)){found=true;break}p=next}
 assert(found,`Missed the 945 m/s trajectory at ${fps} FPS`);results.push({fps,hit:found})
}
assert(!hit(new THREE.Vector3(1.5,0,2),new THREE.Vector3(1.5,0,-2)),'Near miss became hit');
assert(!hit(new THREE.Vector3(0,2,2),new THREE.Vector3(0,2,-2)),'Overhead miss became hit');
assert(hit(new THREE.Vector3(.6,0,2),new THREE.Vector3(.6,0,-2),.11),'Projectile radius omitted');
box.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/4);assert(hit(new THREE.Vector3(0,0,2),new THREE.Vector3(0,0,-2)),'Rotated box missed');
box.quaternion.identity();box.position.set(5,0,0);box.userData.frameStartPosition=new THREE.Vector3(-5,0,0);assert(hit(new THREE.Vector3(),new THREE.Vector3()),'Translating target crossed shot without detection');
console.log('Swept bullet checks passed:',JSON.stringify(results));
