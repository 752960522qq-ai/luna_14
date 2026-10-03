import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../app/src/main/assets/three.module.js';
import {loadGame} from './screen-runtime.mjs';
import {terrainGroup} from './terrain-fixture.mjs';

const core=terrainGroup(),far=terrainGroup('korea-1951-distance.glb'),h=loadGame();
h.context.qaCore=core;h.context.qaFar=far;
h.run('planeModelLoader.loadAsync=file=>Promise.resolve({scene:file.includes("distance")?qaFar:qaCore})');
await h.run('loadKoreaTerrain()');const scenery=await h.run('loadKoreaScenery()');
h.run("setBattleMap('korea1951')");await Promise.resolve();
assert.equal(h.run('viewState.scene.fog.near'),1200);assert.equal(h.run('viewState.camera.far'),4000);
assert.equal(h.run('mapState.terrainFogEnabled.value'),1);
const meshes=[];core.traverse(n=>{if(n.isMesh)meshes.push(n)});assert.equal(meshes.length,4);
const coreBox=new THREE.Box3().setFromObject(core);
assert.deepEqual([coreBox.min.x,coreBox.max.x,coreBox.min.z,coreBox.max.z],[-300,300,-300,300]);
const boxes=meshes.map(m=>new THREE.Box3().setFromObject(m)),shared=new Map();
let duplicateVertices=0,maxEdgeHeightMismatchMeters=0,maxEdgeNormalMismatch=0;
for(const [at,m] of meshes.entries()){
 const b=boxes[at];assert.equal(b.max.x-b.min.x,300);assert.equal(b.max.z-b.min.z,300);
 const p=m.geometry.attributes.position,n=m.geometry.attributes.normal;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),z=p.getZ(i);if(x!==b.min.x&&x!==b.max.x&&z!==b.min.z&&z!==b.max.z)continue;
  const key=[((x+300)%600).toFixed(6),((z+300)%600).toFixed(6)].join('/');
  const row={y:p.getY(i),n:[n.getX(i),n.getY(i),n.getZ(i)]},old=shared.get(key);
  if(old){duplicateVertices++;maxEdgeHeightMismatchMeters=Math.max(maxEdgeHeightMismatchMeters,Math.abs(row.y-old.y)*10);maxEdgeNormalMismatch=Math.max(maxEdgeNormalMismatch,...row.n.map((v,k)=>Math.abs(v-old.n[k])))}else shared.set(key,row);
 }
}
for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
 const a=boxes[i],b=boxes[j];const area=Math.max(0,Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x))*Math.max(0,Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z));assert.equal(area,0,'Tiles overlap in X/Z');
}
assert.equal(maxEdgeHeightMismatchMeters,0);assert.equal(maxEdgeNormalMismatch,0);
assert(h.run('groundPlane.position.y')<coreBox.min.y);
const outside=[];scenery.traverse(n=>{if(n.isMesh)outside.push(n)});
const high=outside.filter(m=>meshes.some(q=>q.geometry===m.geometry)),low=outside.filter(m=>!high.includes(m));
assert.equal(high.length,32);assert.equal(low.length,2);assert(high.every(m=>m.visible&&m.material===meshes[0].material));assert(low.every(m=>m.material===meshes[0].material));
assert(low[0].geometry.index.count<meshes.reduce((s,m)=>s+m.geometry.index.count,0));
scenery.updateMatrixWorld(true);
const highBoxes=high.map(m=>new THREE.Box3().setFromObject(m));const highBox=new THREE.Box3();for(const b of [...boxes,...highBoxes])highBox.union(b);
assert.deepEqual([highBox.min.x,highBox.max.x,highBox.min.z,highBox.max.z],[-900,900,-900,900]);
const ray=new THREE.Raycaster();scenery.updateMatrixWorld(true);let coverageSamples=0,maxExternalHeightErrorMeters=0;
for(const extra of [1,200,599,601,900,1199,1201,1400,1599])for(let a=0;a<96;a++){
 const angle=a/96*Math.PI*2,x=Math.cos(angle),z=Math.sin(angle),scale=(300+extra)/Math.max(Math.abs(x),Math.abs(z));
 ray.set(new THREE.Vector3(x*scale,1000,z*scale),new THREE.Vector3(0,-1,0));const hits=ray.intersectObject(scenery,true);assert(hits.length,'Missing external terrain '+extra+'/'+a);if(extra<600){h.context.qaX=x*scale;h.context.qaZ=z*scale;const error=Math.abs(h.run('terrainHeightAt(qaX,qaZ)')-hits[0].point.y)*10;assert(error<1);maxExternalHeightErrorMeters=Math.max(maxExternalHeightErrorMeters,error)}coverageSamples++;
}
h.run("setBattleMap('openSea')");assert.equal(h.run('mapState.terrainFogEnabled.value'),0);assert.equal(scenery.visible,false);
h.run("setBattleMap('korea1951')");await Promise.resolve();assert.equal(scenery.visible,true);assert(high.every(m=>m.visible));
const report={result:'passed',tiles:boxes.map((b,i)=>({name:'tile-'+(i+1),boundingBoxMeters:{min:b.min.clone().multiplyScalar(10).toArray(),max:b.max.clone().multiplyScalar(10).toArray()},widthMeters:(b.max.x-b.min.x)*10,depthMeters:(b.max.z-b.min.z)*10})),duplicateVertices,maxEdgeHeightMismatchMeters,maxEdgeNormalMismatch,positiveAreaOverlap:0,bottomPlaneYUnits:h.run('groundPlane.position.y'),highDetailTileCount:high.length+4,lowTriangles:low[0].geometry.index.count/3,coverageSamples,maxExternalHeightErrorMeters,checks:['Four 3 km tiles have no X/Z area overlap and exact common edge heights and normals.','External 0–6 km shares the actual core geometry and atlas; 6–12 km uses a coarse ring, then a fog collar.','Bottom plane lies below terrain; world-position fog is enabled only for Korea; map switching preserves visible external terrain.']};
fs.writeFileSync(new URL('distance-v22.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
