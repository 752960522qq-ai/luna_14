import fs from 'node:fs';
import * as THREE from '../app/src/main/assets/three.module.js';

export function terrainGroup(){
 const data=fs.readFileSync(new URL('../app/src/main/assets/korea-1951-terrain.glb',import.meta.url));
 const jsonBytes=data.readUInt32LE(12),json=JSON.parse(data.subarray(20,20+jsonBytes).toString()),binStart=20+jsonBytes+8;
 const types={SCALAR:1,VEC2:2,VEC3:3,VEC4:4},bytes={5121:1,5123:2,5125:4,5126:4};
 function accessor(index){
  const a=json.accessors[index],v=json.bufferViews[a.bufferView],size=types[a.type],width=bytes[a.componentType],stride=v.byteStride||size*width;
  const output=a.componentType===5126?new Float32Array(a.count*size):a.componentType===5125?new Uint32Array(a.count*size):new Uint16Array(a.count*size);
  for(let i=0;i<a.count;i++)for(let k=0;k<size;k++){
   const offset=binStart+(v.byteOffset||0)+(a.byteOffset||0)+i*stride+k*width;
   output[i*size+k]=a.componentType===5126?data.readFloatLE(offset):a.componentType===5125?data.readUInt32LE(offset):a.componentType===5123?data.readUInt16LE(offset):data.readUInt8(offset);
  }return new THREE.BufferAttribute(output,size);
 }
 const objects=json.nodes.map(n=>{
  const o=new THREE.Group();o.name=n.name||'';
  if(n.matrix){o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale)}
  else{if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale)}
  if(n.mesh!==undefined)for(const p of json.meshes[n.mesh].primitives){const g=new THREE.BufferGeometry();g.setAttribute('position',accessor(p.attributes.POSITION));if(p.indices!==undefined)g.setIndex(accessor(p.indices));o.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})))}
  return o;
 });
 json.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>objects[i].add(objects[c])));
 const root=new THREE.Group();for(const id of json.scenes[json.scene||0].nodes)root.add(objects[id]);return root;
}
