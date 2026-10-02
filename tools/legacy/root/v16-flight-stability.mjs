// Fixed simulation keeps the entire active frame interval, with bounded catch-up.
const BATTLE_TIMING={stepSeconds:1/120,maxStepsPerFrame:48,hudIntervalSeconds:.05};
let battleSimulationAccumulator=0,battleHudElapsed=Infinity,cameraTrackedRoot=null;
const cameraAnchorPosition=new THREE.Vector3(),cameraAnchorDelta=new THREE.Vector3(),battleRenderRoots=[];

function followCameraAnchor(root){
 if(cameraTrackedRoot!==root){cameraTrackedRoot=root;cameraPoseInitialized=false;cameraAnchorPosition.copy(root.position)}
 else if(cameraPoseInitialized){cameraAnchorDelta.copy(root.position).sub(cameraAnchorPosition);camera.position.add(cameraAnchorDelta)}
 cameraAnchorPosition.copy(root.position)
}
function shouldUpdateBattleHUD(dt){
 battleHudElapsed+=dt;
 if(battleHudElapsed+1e-9<BATTLE_TIMING.hudIntervalSeconds)return false;
 battleHudElapsed=0;return true
}
function activeBattleAircraft(){
 if(gameMode==='airspace')return airspaceLiveUnits().map(unit=>unit.root);
 return[player,...(gameMode==='campaign'?campaignTargets().map(target=>target.root):[enemy])].filter(Boolean)
}
function applyBattleRenderPose(){
 battleRenderRoots.length=0;
 const step=gameMode==='airspace'?AIRSPACE_RULES.stepSeconds:BATTLE_TIMING.stepSeconds;
 const remainder=gameMode==='airspace'?airspaceAccumulator:battleSimulationAccumulator;
 const alpha=THREE.MathUtils.clamp(remainder/step,0,1);
 for(const root of activeBattleAircraft()){
  const data=root.userData;if(!data.renderPreviousPosition)continue;
  (data.renderActualPosition??=new THREE.Vector3()).copy(root.position);
  (data.renderActualQuaternion??=new THREE.Quaternion()).copy(root.quaternion);
  root.position.lerpVectors(data.renderPreviousPosition,data.renderActualPosition,alpha);
  root.quaternion.copy(data.renderPreviousQuaternion).slerp(data.renderActualQuaternion,alpha);
  battleRenderRoots.push(root)
 }
}
function restoreBattlePhysicsPose(){
 for(const root of battleRenderRoots){root.position.copy(root.userData.renderActualPosition);root.quaternion.copy(root.userData.renderActualQuaternion)}
 battleRenderRoots.length=0
}
function advanceBattleSimulation(elapsed){
 if(!playing)return;
 battleSimulationAccumulator+=elapsed;let steps=0;
 while(battleSimulationAccumulator>=BATTLE_TIMING.stepSeconds-1e-9&&steps<BATTLE_TIMING.maxStepsPerFrame&&playing){
  updateNonAirspaceStep(BATTLE_TIMING.stepSeconds);
  battleSimulationAccumulator=Math.max(0,battleSimulationAccumulator-BATTLE_TIMING.stepSeconds);steps++
 }
}
function advanceAirspaceSimulation(elapsed){
 if(!playing)return;
 airspaceAccumulator+=elapsed;let steps=0;
 while(airspaceAccumulator>=AIRSPACE_RULES.stepSeconds-1e-9&&steps<24&&playing){
  updateAirspaceStep(AIRSPACE_RULES.stepSeconds);
  airspaceAccumulator=Math.max(0,airspaceAccumulator-AIRSPACE_RULES.stepSeconds);steps++
 }
}
function limitAICeilingDirection(root,direction){
 const data=root.userData;if(data.isPlayer!==false||data.modelContext==='preview')return direction;
 const ceiling=AI_TACTICS.maxAltitudeMeters/METERS_PER_UNIT-90,gap=(ceiling-root.position.y)*METERS_PER_UNIT;
 if(gap>180)return direction;
 const result=direction.clone().normalize(),speed=Math.max(data.airspeed,30);
 const climbLimit=THREE.MathUtils.clamp((gap-50)/(speed*4),-.20,.20);
 if(result.y<=climbLimit)return result;
 const flat=result.setY(0);if(flat.lengthSq()<1e-6)flat.set(0,0,-1).applyQuaternion(root.quaternion).setY(0);
 return flat.normalize().multiplyScalar(Math.sqrt(1-climbLimit*climbLimit)).setY(climbLimit)
}
function enforceAICeiling(root){
 const data=root.userData;if(data.isPlayer!==false||data.modelContext==='preview'||data.destroyed)return;
 const ceiling=AI_TACTICS.maxAltitudeMeters/METERS_PER_UNIT-90;
 if(root.position.y>ceiling){root.position.y=ceiling;data.velocity.y=Math.min(data.velocity.y,0);data.airspeed=data.velocity.length()*METERS_PER_UNIT}
}
function setBattleLoading(active,message='正在准备战区…'){
 const overlay=$('#battleLoading');if(!overlay)return;
 overlay.classList.toggle('hidden',!active);$('#battleLoadingText').textContent=message
}
function ensureBulletResources(type,id){
 const resourceId=type+':'+id,spec=weaponInfo[type][id];
 return bulletResources[resourceId]??=( {geometry:new THREE.SphereGeometry(spec.radius/METERS_PER_UNIT,8,8),material:new THREE.MeshBasicMaterial({color:spec.color})} )
}
async function warmBattleRenderer(){
 const warmMeshes=[];
 try{
  await Promise.all(Object.values(planeModelPromises));await Promise.resolve();
  updateChaseCamera(0);
  for(const type of new Set(activeBattleAircraft().map(root=>root.userData.type))){
   for(const id of Object.keys(weaponInfo[type]||{})){
    const resource=ensureBulletResources(type,id),mesh=new THREE.Mesh(resource.geometry,resource.material);
    mesh.position.copy(player.position).add(new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion));mesh.scale.setScalar(.001);mesh.frustumCulled=false;scene.add(mesh);warmMeshes.push(mesh)
   }
  }
  if(renderer.compileAsync)await renderer.compileAsync(scene,camera);else if(renderer.compile)renderer.compile(scene,camera);
  renderer.render(scene,camera)
 }finally{for(const mesh of warmMeshes)scene.remove(mesh)}
}
async function prepareCampaignBattle(){
 const token=++airspacePrepareToken,button=$('#beginCampaign');button.disabled=true;setBattleLoading(true,'正在准备战役…');
 try{
  const [terrain]=await Promise.all([loadKoreaTerrain(),...['mig15','b29','f86'].map(loadPlaneModel),...audioLoads.values()]);
  if(token!==airspacePrepareToken)return;if(!terrain)throw new Error('地图未加载');
  if(!koreaHeightGrid)koreaHeightGrid=buildKoreaHeightGrid(terrain);
  gameMode='campaign';reset({preparing:true});await warmBattleRenderer();
  if(token!==airspacePrepareToken)return;
  playing=true;battleSimulationAccumulator=0;battleHudElapsed=Infinity;clock.getDelta();startEngineSound(playerPlane);updateCampaignHud();setBattleLoading(false)
 }catch(error){if(token===airspacePrepareToken){console.error('战役准备失败',error);showMenuScreen('campaignBriefing');toast('战役准备失败，请重试。')}}
 finally{button.disabled=false;if(token===airspacePrepareToken)setBattleLoading(false)}
}
