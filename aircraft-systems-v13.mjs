// All bounds/hinges here are in aircraft coordinates: +Y up, +Z aft, 1 unit = 10 m.
function aircraftLocalBounds(root,objects){
 root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),box=new THREE.Box3(),point=new THREE.Vector3();
 for(const object of objects)object.traverse(node=>{
  if(!node.isMesh)return;if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();
  const bounds=node.geometry.boundingBox,matrix=inverse.clone().multiply(node.matrixWorld);
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])box.expandByPoint(point.set(x,y,z).applyMatrix4(matrix))
 });
 return box
}
function configureCombatLandingGear(root,model){
 const type=root.userData.type;if(root.userData.modelContext==='preview'||!['f3f2','p36a'].includes(type))return;
 const settings=type==='f3f2'?{mainY:-.040,mainX:.033,rearShift:.025,tailY:-.025,tailFloor:-.025}:{mainY:.007,mainX:.020,rearShift:0,tailY:.008,tailFloor:-.004};
 // Cylinder_29 / Cylinder001_30 are separately authored P-36A wheel hubs.
 const patterns=type==='f3f2'?[/^(?:gear_l\d*|wheel_l)$/i,/^(?:gear_r\d*|wheel_r)$/i,/^(?:gear_c\d*|wheel_c)$/i]:[/^(?:left.*gear.*|Cylinder_29)$/i,/^(?:right.*gear.*|Cylinder001_30)$/i,/^tail.*(?:gear|wheel)/i];
 const assemblies=[];
 for(let i=0;i<patterns.length;i++){
  const parts=[];model.traverse(node=>{if(patterns[i].test(node.name))parts.push(node)});
  const wheels=parts.filter(node=>/wheel/i.test(node.name)&&!/cover|ax/i.test(node.name));
  if(!parts.length||!wheels.length)throw new Error('缺少起落架节点：'+type+' / '+i);
  const before=aircraftLocalBounds(root,wheels).getCenter(new THREE.Vector3()),bounds=aircraftLocalBounds(root,parts),pivot=new THREE.Group();
  pivot.name='FlightGear_'+['Left','Right','Tail'][i];pivot.position.set(before.x,bounds.max.y,before.z);root.add(pivot);
  // Attach preserves the authored geometry, while keeping this transform exclusive to this clone.
  for(const part of parts)pivot.attach(part);
  pivot.rotation.x=-Math.PI/2;root.updateMatrixWorld(true);
  const turned=aircraftLocalBounds(root,wheels).getCenter(new THREE.Vector3()),targetX=i===2?0:Math.sign(before.x)*settings.mainX;
  pivot.position.x+=targetX-turned.x;pivot.position.y+=(i===2?settings.tailY:settings.mainY)-turned.y;
  if(i!==2)pivot.position.z+=settings.rearShift;
  root.updateMatrixWorld(true);
  if(i===2){const foldedBounds=aircraftLocalBounds(root,parts);pivot.position.y+=Math.max(0,settings.tailFloor-foldedBounds.min.y);root.updateMatrixWorld(true)}
  const after=aircraftLocalBounds(root,wheels).getCenter(new THREE.Vector3());
  assemblies.push({name:pivot.name,pivot,parts:parts.map(part=>part.name),wheelBefore:before.toArray(),wheelAfter:after.toArray(),foldAngleDegrees:-90})
 }
 root.userData.landingGear={state:'stowed',assemblies}
}
function attachPropeller(root,source,spec){
 const settings=PROPELLER_SPECS[root.userData.type];if(!settings)return;
 const type=root.userData.type;
 let pivot=source.getObjectByName('PropellerPivot'),blades=pivot?.getObjectByName('PropellerBlades');
 if(type==='p36a'){pivot=source.getObjectByName('prop_49');blades=pivot?.children.filter(node=>node.isMesh)||[]}
 if(type==='f3f2'){
  const authored=source.getObjectByName('prop01_1');if(!authored)throw new Error('缺少 F3F-2 螺旋桨');
  pivot=new THREE.Group();pivot.name='PropellerPivot';pivot.position.set(0,-.292092,-2.30);
  authored.parent.add(pivot);pivot.attach(authored);blades=[authored]
 }
 if(!pivot||!blades||(Array.isArray(blades)&&!blades.length))throw new Error('缺少螺旋桨旋转节点：'+type);
 const scaled=['p36a','f3f2'].includes(type),worldScale=scaled?pivot.getWorldScale(new THREE.Vector3()):null;
 const discRadius=scaled?settings.radius/METERS_PER_UNIT/Math.max(Math.abs(worldScale.x),.0001):settings.radius;
 const disc=new THREE.Mesh(new THREE.PlaneGeometry(discRadius*2,discRadius*2),new THREE.MeshBasicMaterial({map:makePropellerBlurTexture(),transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
 disc.name='PropellerMotionBlur';if(type==='f3f2')disc.position.z=-.015;else{disc.rotation.x=Math.PI/2;disc.position.y=-.015}
 disc.visible=false;disc.renderOrder=2;pivot.add(disc);
 const spinAxis=type==='f3f2'?new THREE.Vector3(0,0,-1):new THREE.Vector3(0,1,0);
 root.userData.propeller={pivot,blades,disc,baseQuaternion:pivot.quaternion.clone(),spinQuaternion:new THREE.Quaternion(),spinAxis};
 root.userData.propeller.spinQuaternion.setFromAxisAngle(spinAxis,root.userData.propPhase||0);pivot.quaternion.copy(root.userData.propeller.baseQuaternion).multiply(root.userData.propeller.spinQuaternion)
}
