import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../app/src/main/assets/three.module.js';
import {loadGame} from './screen-runtime.mjs';
import {terrainGroup} from './terrain-fixture.mjs';

const core = terrainGroup(), scenery = terrainGroup('korea-1951-distance.glb');
const h = loadGame();
h.context.qaCore = core; h.context.qaScenery = scenery;
h.run('planeModelLoader.loadAsync=file=>Promise.resolve({scene:file.includes("distance")?qaScenery:qaCore})');
await h.run('loadKoreaTerrain()'); await h.run('loadKoreaScenery()');
h.run("setBattleMap('korea1951')"); await Promise.resolve();
assert.equal(h.run('viewState.scene.fog.near'), 500);
assert.equal(h.run('viewState.camera.far'), 2800);
assert(h.run('viewState.scene.background.equals(viewState.scene.fog.color)'));
const box = new THREE.Box3().setFromObject(core);
assert.equal(box.min.x, -300); assert.equal(box.max.x, 300);
assert.equal(box.min.z, -300); assert.equal(box.max.z, 300);
let tiles = 0, edgeVertices = 0;
core.traverse(n => {
  if (!n.isMesh) return;
  tiles++;
  const p = n.geometry.attributes.position;
  const b = new THREE.Box3().setFromBufferAttribute(p);
  assert.equal(b.max.x - b.min.x, 300); assert.equal(b.max.z - b.min.z, 300);
  for (let i = 0; i < p.count; i++) {
    if (p.getX(i) === b.min.x || p.getX(i) === b.max.x || p.getZ(i) === b.min.z || p.getZ(i) === b.max.z) {
      assert(Math.abs(p.getY(i) + 90) < 1e-5); edgeVertices++;
    }
  }
});
assert.equal(tiles, 4);
const meshes = []; scenery.traverse(n => {if(n.isMesh) meshes.push(n)});
assert.equal(meshes.length, 2);
assert(meshes[1].geometry.index.count < meshes[0].geometry.index.count / 2);
scenery.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
let coverageSamples = 0;
for (const radius of [430, 600, 900, 1190, 1210, 1500, 1990]) for (let a = 0; a < 128; a++) {
  const angle = a / 128 * Math.PI * 2;
  ray.set(new THREE.Vector3(Math.cos(angle) * radius, 1000, Math.sin(angle) * radius), new THREE.Vector3(0, -1, 0));
  assert(ray.intersectObject(scenery, true).length > 0, 'Missing scenery at ' + radius + '/' + a);
  coverageSamples++;
}
const report = {result: 'passed', tiles, edgeVertices, coverageSamples,
  checks: ['Four 3 km tiles cover exactly 6 km × 6 km; all shared edge heights agree.',
    'Medium scenery joins the map; the 12–20 km mesh has less than half its triangle count and every tested bearing has ground.',
    'Fog starts at 5 km, matches the sky at the horizon, and the camera reaches 28 km while combat bounds stay 6 km.']};
fs.writeFileSync(new URL('distance-v21.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
