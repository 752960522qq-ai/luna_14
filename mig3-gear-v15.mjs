// The source GLB and catalog keep their authored, extended landing gear.
function configureMiG3CombatLandingGear(root,model){
 if(root.userData.type!=='mig3'||root.userData.modelContext==='preview')return;
 root.updateMatrixWorld(true);
 const sourceFrame=model.getObjectByName('MiG3_8_25m_YUp_NoseMinusZ');
 if(!sourceFrame)throw new Error('缺少 MiG-3 标准尺寸节点');
 const point=(x,y,z)=>root.worldToLocal(sourceFrame.localToWorld(new THREE.Vector3(x,y,z)));
 const scale=point(1,0,0).distanceTo(point(0,0,0));
 const part=name=>{const node=root.getObjectByName(name);if(!node)throw new Error('缺少 MiG-3 起落架部件：'+name);return node};
 const assemblies=[],doorMaterial=new THREE.MeshStandardMaterial({color:0x3d728a,roughness:.82,metalness:.12});
 function closedDoors(name,side){
  const doors=new THREE.Group();doors.name=name;root.add(doors);
  const count=side?3:2;
  for(let i=0;i<count;i++){
   const width=side?.498:.058,length=side?.84:.52;
   const panel=new THREE.Mesh(new THREE.BoxGeometry(width*scale,.008*scale,length*scale),doorMaterial);
   panel.name=name+'_Segment_'+(i+1);panel.position.copy(side?point(side*(.5+i*.5),-.585,-1.60):point((i-.5)*.06,-.087,3.385));
   panel.castShadow=true;panel.receiveShadow=true;doors.add(panel)
  }
  if(side){
   // A shallow underside fairing gives the horizontal tire its required depth.
   const rim=new THREE.Group();rim.name=name+'_BayFairing';root.add(rim);
   for(const edge of [0,1,2,3]){
    const longitudinal=edge<2;
    const wall=new THREE.Mesh(new THREE.BoxGeometry((longitudinal?.012:1.5)*scale,.118*scale,(longitudinal?.84:.012)*scale),doorMaterial);
    wall.position.copy(longitudinal?point(side*(edge===0?.25:1.75),-.526,-1.6):point(side,-.526,edge===2?-2.02:-1.18));rim.add(wall)
   }
  }
  return doors
 }
 function fold(name,names,wheelName,hinge,axis,angle,side){
  const parts=names.map(part),wheels=[part(wheelName)],before=aircraftLocalBounds(root,wheels).getCenter(new THREE.Vector3());
  const pivot=new THREE.Group();pivot.name=name;pivot.position.copy(point(...hinge));root.add(pivot);
  for(const node of parts)pivot.attach(node);
  pivot.rotation[axis]=angle;root.updateMatrixWorld(true);
  if(side){
   // Seat the tire/hub below the wing's upper skin, inside the closed bay.
   const center=aircraftLocalBounds(root,wheels).getCenter(new THREE.Vector3()),offset=point(0,-.47,0).y-center.y;
   for(const node of [part(wheelName),part(side<0?'Cylinder18':'Cylinder14')]){root.attach(node);node.position.y+=offset}
   root.updateMatrixWorld(true)
  }
  const after=aircraftLocalBounds(root,wheels).getCenter(new THREE.Vector3()),doors=closedDoors(name+'_ClosedDoors',side);
  assemblies.push({name,pivot,parts:parts.map(node=>node.name),wheelBefore:before.toArray(),wheelAfter:after.toArray(),foldAxis:axis,foldAngleDegrees:angle*180/Math.PI,doors,doorSegments:doors.children.length,doorState:'closed'});
 }
 // Roll each main wheel inward until the tire lies flat inside the inner wing.
 fold('MiG3MainGearLeft',['Cylinder11','Box04','Cylinder12','Box02','Cylinder18','Torus04'],'Torus04',[-1.65,-.60,-1.388],'z',Math.PI/2,-1);
 fold('MiG3MainGearRight',['Cylinder16','Box06','Cylinder15','Box05','Cylinder14','Torus03'],'Torus03',[1.65,-.60,-1.388],'z',-Math.PI/2,1);
 // The short inboard actuators fold into the wing instead of following the wheel.
 for(const [name,side]of [['stv_gl',-1],['stv_gl01',1]]){
  const hinge=new THREE.Group();hinge.name='MiG3InboardLink_'+(side<0?'Left':'Right');hinge.position.copy(point(side*.37,-.45,-1.283));root.add(hinge);hinge.attach(part(name));hinge.rotation.z=-side*Math.PI/2
 }
 // Original extended covers are retained in this clone behind the closed panels.
 for(const name of ['st_gl_1','st_gl_02'])part(name).visible=false;
 // Retract the tail wheel upward and aft into the fuselage, then close its two leaves.
 fold('MiG3TailGear',['Cylinder10','Cylinder09','Cylinder07','Box01','Torus02','Cylinder02'],'Torus02',[0,-.12,3.08],'x',-Math.PI/2,0);
 // Closed tail doors occlude all internal hardware at the rounded tail skin.
 for(const name of assemblies[2].parts)part(name).visible=false;
 for(const name of ['stv_xv','stv_xv01'])part(name).visible=false;
 root.updateMatrixWorld(true);
 root.userData.landingGear={state:'stowed',assemblies,mainRetraction:'inward-wing-bays',tailRetraction:'aft-fuselage',doorState:'closed'}
}
