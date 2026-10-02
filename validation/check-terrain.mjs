import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../app/src/main/assets/three.module.js';
import {loadGame} from './screen-runtime.mjs';
import {terrainGroup} from './terrain-fixture.mjs';

const h=loadGame(),raw=terrainGroup();h.context.qaTerrain=raw;
h.run('planeModelLoader.loadAsync=()=>Promise.resolve({scene:qaTerrain})');
const terrain=await h.run('loadKoreaTerrain()');
const started=performance.now();h.run("activeMapId='korea1951';koreaHeightGrid=buildKoreaHeightGrid(koreaTerrain)");
const buildMilliseconds=performance.now()-started,grid=h.run('koreaHeightGrid'),box=new THREE.Box3().setFromObject(terrain),ray=new THREE.Raycaster();
let samples=0,floorFallbacks=0,maxUnderevaluationMeters=0,maxAbsoluteErrorMeters=0;
function probe(x,z){
 ray.set(new THREE.Vector3(x,box.max.y+10,z),new THREE.Vector3(0,-1,0));const hit=ray.intersectObject(terrain,true)[0];if(!hit)return;
 h.context.qaX=x;h.context.qaZ=z;const estimate=h.run('terrainHeightAt(qaX,qaZ)'),difference=(hit.point.y-estimate)*10;
 samples++;if(estimate===-90&&hit.point.y>-89)floorFallbacks++;
 maxUnderevaluationMeters=Math.max(maxUnderevaluationMeters,difference);maxAbsoluteErrorMeters=Math.max(maxAbsoluteErrorMeters,Math.abs(difference));
}
for(let ix=1;ix<33;ix++)for(let iz=1;iz<33;iz++)probe(box.min.x+(box.max.x-box.min.x)*ix/33,box.min.z+(box.max.z-box.min.z)*iz/33);
// Exercise the outer raster row and column as well as the interior.
for(let at=1;at<65;at++){
 const x=THREE.MathUtils.lerp(box.min.x,box.max.x,at/65),z=THREE.MathUtils.lerp(box.min.z,box.max.z,at/65),inset=.01;
 probe(box.min.x+inset,z);probe(box.max.x-inset,z);probe(x,box.min.z+inset);probe(x,box.max.z-inset);
}
assert.equal(floorFallbacks,0);assert(maxUnderevaluationMeters<1,'Terrain height underestimated by more than one metre');assert(maxAbsoluteErrorMeters<1,'Terrain raster error exceeded one metre');
const report={result:'passed',method:'Actual packaged GLB vertex/index/node transforms compared with downward Three.js ray intersections; CPU geometry, no textures or GPU.',resolution:grid.resolution,gridBytes:grid.heights.byteLength,buildMilliseconds,samples,floorFallbacks,maxUnderevaluationMeters,maxAbsoluteErrorMeters,oldSampledMaxUnderevaluationMeters:12.48};
fs.writeFileSync(new URL('terrain-v19.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
