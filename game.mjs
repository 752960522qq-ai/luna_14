

import * as THREE from './three.module.js';
import { GLTFLoader } from './GLTFLoader.js';
import { DRACOLoader } from './DRACOLoader.js';
const FLIGHT_PHYSICS={stepSeconds:1/120,maxBankRadians:85*Math.PI/180,liftResponse:4.5,aoaSoft:.13,aoaLimit:.26,negativePitchFraction:.75};
const DUEL_BOUNDARY_RULES={aiMarginMeters:100,playerMarginMeters:300,desertionSeconds:15};
let koreaTerrainBounds=null,duelDesertionRemaining=null;


const $=s=>document.querySelector(s), sceneRoot=$('#scene');let scene,camera,renderer,clock,player,enemy,playerPlane='f86',enemyPlaneType='mig15',weaponMode='mg',enemyWeaponMode='both',playerAmmo={mg:1800,n37:40,ns23:160,hispano:720},enemyAmmo={mg:1800,n37:40,ns23:160,hispano:720},playerWeaponCooldowns={mg:0,m2:0,mg762:0,n37:0,ns23:0,hispano:0},enemyWeaponCooldowns={mg:0,m2:0,mg762:0,n37:0,ns23:0,hispano:0},playing=false,ended=false,kills=0,hp=700,eHp=600,throttleValue=1,hitFlash=0,worldTime=0,previewRenderer=null,previewScene=null,previewCamera=null,previewPlane=null,previewType='mig15';const keys={up:false,down:false,left:false,right:false,fire:false,bomb:false,look:false};const joystickInput={x:0,y:0};const FLIGHT_CONTROL={deadzone:.08,sideslipAssistRate:.85,sideslipAssistMaxFraction:.22,cameraPositionResponse:16,cameraRotationResponse:18};const AI_CONTROL={rollResponse:7,pitchResponse:7};let cameraOrbitYaw=0,cameraOrbitPitch=0,cameraInputAt=-1,cameraDragPointer=null,cameraPoseInitialized=false,filteredControlX=0,filteredControlY=0;const bullets=[],bulletPool=[],bulletResources={};const bombsInFlight=[];let bombKeyWasDown=false;const clouds=[];const tmp=new THREE.Vector3();
const CAMPAIGN_DURATION=300,CAMPAIGN_RESUPPLY_INTERVAL=50,CAMPAIGN_ESCORT_LIMIT=5,CAMPAIGN_ESCORT_RESPAWN=30;let gameMode='airspace',campaignElapsed=0,campaignTimeRemaining=CAMPAIGN_DURATION,campaignResupplyRemaining=CAMPAIGN_RESUPPLY_INTERVAL,campaignEscortSerial=0,campaignBomberPhase=0;const campaignBombers=[],campaignEscorts=[],campaignRespawns=[],campaignMarkerNodes=new Map();
// Game coordinates: +X right, +Y up, nose toward -Z; 1 world unit = 10 m.
const METERS_PER_UNIT=10,SPAWN_DISTANCE_METERS=2000;
// v10: persistent flight controls; the direction ring commands the instructor,
// while the real gunsight and lead indicator follow the existing projectile model.
// Airspace uses the existing aircraft physics; distances below are in metres.
const AIRSPACE_RULES={teamSize:5,mapMeters:6000,captureRadiusMeters:300,captureSeconds:15,baseRadiusMeters:300,supplyRate:.1,scoreRate:1,scoreToWin:100,stepSeconds:1/60};
const airspaceUnits=[],airspaceMarkerNodes=new Map();
let airspaceState=null,airspaceSpectating=false,airspaceObservedId=null,airspaceAccumulator=0,airspacePrepareToken=0;

function createAirspaceState(){return{progress:0,owner:null,scores:{blue:0,red:0},counts:{blue:0,red:0},elapsed:0,winner:undefined,point:new THREE.Vector3(),bases:{blue:new THREE.Vector3(),red:new THREE.Vector3()}}}
function airspaceLiveUnits(team=null){return airspaceUnits.filter(unit=>!unit.dead&&unit.health>0&&(!team||unit.team===team))}
function airspaceUnitFor(root){return root?.userData.airspaceUnit||null}
function airspacePlayerAlive(){return gameMode!=='airspace'||!!airspaceUnitFor(player)&&!airspaceUnitFor(player).dead}
function airspaceWithin(point,center,radiusMeters){return point.distanceToSquared(center)<=(radiusMeters/METERS_PER_UNIT)**2+1e-9}

// A signed meter takes 15 seconds from neutral and 30 from the opposite end.
// Only a strict numerical advantage advances it; ties and an empty point freeze it.
function advanceAirspaceObjective(state,units,dt){
 const counts={blue:0,red:0};
 for(const unit of units)if(!unit.dead&&unit.health>0&&airspaceWithin(unit.root.position,state.point,AIRSPACE_RULES.captureRadiusMeters))counts[unit.team]++;
 state.counts=counts;state.elapsed+=dt;
 const advantage=Math.sign(counts.blue-counts.red),oldOwner=state.owner,oldProgress=state.progress;
 if(advantage)state.progress=THREE.MathUtils.clamp(oldProgress+advantage*dt/AIRSPACE_RULES.captureSeconds,-1,1);
 if(state.progress>=1-1e-9){state.progress=1;state.owner='blue'}
 else if(state.progress<=-1+1e-9){state.progress=-1;state.owner='red'}
 // Split the step at the ownership change so scores do not depend on frame rate.
 if(oldOwner!==state.owner){
  const transition=advantage?Math.min(dt,Math.abs((advantage-oldProgress)*AIRSPACE_RULES.captureSeconds)):dt;
  if(oldOwner)state.scores[oldOwner]+=transition*AIRSPACE_RULES.scoreRate;
  if(state.owner)state.scores[state.owner]+=(dt-transition)*AIRSPACE_RULES.scoreRate;
 }else if(state.owner)state.scores[state.owner]+=dt*AIRSPACE_RULES.scoreRate;
 for(const team of ['blue','red'])state.scores[team]=Math.min(AIRSPACE_RULES.scoreToWin,state.scores[team]);
}
function replenishAirspaceUnit(unit,base,dt){
 if(unit.dead||unit.health<=0||!airspaceWithin(unit.root.position,base,AIRSPACE_RULES.baseRadiusMeters))return false;
 unit.health=Math.min(unit.maxHealth,unit.health+unit.maxHealth*AIRSPACE_RULES.supplyRate*dt);
 for(const [id,capacity]of Object.entries(unit.maxAmmo)){
  if(id==='bombWeightLb'||capacity<=0)continue;
  if(unit.ammo[id]>=capacity){unit.supplyFractions[id]=0;continue}
  const recovered=(unit.supplyFractions[id]||0)+capacity*AIRSPACE_RULES.supplyRate*dt,rounds=Math.floor(recovered+1e-9);
  unit.supplyFractions[id]=recovered-rounds;unit.ammo[id]=Math.min(capacity,(unit.ammo[id]||0)+rounds);
 }
 return true
}
function airspaceAmmoFraction(unit){let have=0,capacity=0;for(const[id,max]of Object.entries(unit.maxAmmo)){if(id==='bombWeightLb'||id==='bombs')continue;have+=unit.ammo[id]||0;capacity+=max}return capacity?have/capacity:1}
function airspaceWinner(state,units){
 const blue=units.some(u=>u.team==='blue'&&!u.dead&&u.health>0),red=units.some(u=>u.team==='red'&&!u.dead&&u.health>0);
 if(!blue&&!red)return null;
 if(!red)return 'blue';if(!blue)return 'red';
 if(state.scores.blue>=AIRSPACE_RULES.scoreToWin-1e-9)return 'blue';
 if(state.scores.red>=AIRSPACE_RULES.scoreToWin-1e-9)return 'red';
 return undefined
}
function clearAirspaceEntities(){
 for(const unit of airspaceUnits)scene.remove(unit.root);
 for(const node of airspaceMarkerNodes.values())node.remove();airspaceMarkerNodes.clear();airspaceUnits.length=0;
 airspaceState=null;airspaceSpectating=false;airspaceObservedId=null;airspaceAccumulator=0;
 $('#airspaceHud').classList.add('hidden');$('#airspaceMarkers').classList.add('hidden');$('#spectatorControls').classList.add('hidden');
 $('#hud').classList.remove('spectating','airspace');$('#throttleControl').classList.remove('hidden');
}
function makeAirspaceUnit(team,index,type,root){
 const isPlayer=root===player,ammo=isPlayer?playerAmmo:freshAmmo(type),mode=isPlayer?weaponMode:type==='mig15'?['n37','ns23','both'][Math.floor(Math.random()*3)]:type==='meteor'?'hispano':'mg';
 const unit={id:team+'-'+index,team,index,type,root,isPlayer,health:planeInfo[type].health,maxHealth:planeInfo[type].health,ammo,maxAmmo:{...ammo},supplyFractions:{},weaponMode:mode,weaponCooldowns:isPlayer?playerWeaponCooldowns:{mg:0,m2:0,mg762:0,n37:0,ns23:0,hispano:0},dead:false,targetId:null,targetDecision:0,resupplying:false,patrolPhase:index*Math.PI/4};
 Object.assign(root.userData,{airspaceUnit:unit,team,ammo:unit.ammo,weaponMode:unit.weaponMode,weaponCooldowns:unit.weaponCooldowns,engineRunning:true});
 if(!isPlayer&&type!=='b29')initializeFighterAI(root,'airspace',index);
 airspaceUnits.push(unit);return unit
}
function startAirspaceBattle(){
 airspaceState=createAirspaceState();
 // A common flight level keeps the initial diagonal routes above the terrain.
 let highest=terrainHeightAt(0,0);
 for(let x=-280;x<=280;x+=40)for(let z=-280;z<=280;z+=40)highest=Math.max(highest,terrainHeightAt(x,z));
 const altitude=Math.max(terrainHeightAt(0,0)+70,highest+35);
 airspaceState.point.set(0,altitude,0);airspaceState.bases.blue.set(-260,altitude,260);airspaceState.bases.red.set(260,altitude,-260);
 const slots=[[0,0],[-8,8],[8,8],[-16,16],[16,16],[-24,24],[24,24],[0,28]];
 for(const team of ['blue','red']){
  const base=airspaceState.bases[team],forward=airspaceState.point.clone().sub(base).normalize(),right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
  for(let index=0;index<AIRSPACE_RULES.teamSize;index++){
   const isPlayer=team==='blue'&&index===0,type=isPlayer?playerPlane:chooseDuelOpponent(playerPlane),root=isPlayer?player:aircraft(false,type);
   root.position.copy(base).addScaledVector(right,slots[index][0]).addScaledVector(forward,-slots[index][1]);
   root.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),forward);
   root.userData.velocity.copy(forward).multiplyScalar(root.userData.airspeed/METERS_PER_UNIT);
   root.userData.throttle=isPlayer?throttleValue:.82;
   if(PROPELLER_SPECS[type])root.userData.propRpm=PROPELLER_SPECS[type].idleRpm+(PROPELLER_SPECS[type].maxRpm-PROPELLER_SPECS[type].idleRpm)*root.userData.throttle;
   if(!isPlayer){enforceAICeiling(root);scene.add(root)}makeAirspaceUnit(team,index,type,root);
  }
 }
 enemy=airspaceLiveUnits('red')[0].root;enemyPlaneType=enemy.userData.type;eHp=airspaceUnitFor(enemy).health;
 airspaceSpectating=false;airspaceObservedId=null;airspaceAccumulator=0;resetCursorControl();
 $('#hud').classList.add('airspace');$('#airspaceHud').classList.remove('hidden');$('#airspaceMarkers').classList.remove('hidden');$('#spectatorControls').classList.add('hidden');
 $('#radarScale').textContent='6 × 6 km';updateAirspaceHUD();
}
async function prepareAirspaceBattle(){
 const token=++airspacePrepareToken,button=$('#chooseAIBattle');button.disabled=true;setBattleLoading(true,'正在准备空域与编队…');$('#airspaceLoadStatus').textContent='正在加载空域与编队…';
 try{
  const [terrain]=await Promise.all([loadKoreaTerrain(),...duelOpponentsFor(selectedAircraft).map(loadPlaneModel),...audioLoads.values()]);
  if(token!==airspacePrepareToken)return;
  if(!terrain)throw new Error('地图未加载');
  if(!koreaHeightGrid)koreaHeightGrid=buildKoreaHeightGrid(terrain);
  gameMode='airspace';reset({preparing:true});await warmBattleRenderer();if(token!==airspacePrepareToken)return;playing=true;airspaceAccumulator=0;battleHudElapsed=Infinity;clock.getDelta();startEngineSound(playerPlane);setBattleLoading(false);
 }catch(error){if(token===airspacePrepareToken){console.error('空域加载失败',error);$('#airspaceLoadStatus').textContent='加载失败，请重新进入空域。'}}
 finally{if(token===airspacePrepareToken){button.disabled=false;setBattleLoading(false);if(playing)$('#airspaceLoadStatus').textContent=''}}
}
function nearestAirspaceHostile(unit){
 let closest=null,distance=Infinity;
 for(const candidate of airspaceLiveUnits())if(candidate.team!==unit.team){const d=unit.root.position.distanceToSquared(candidate.root.position);if(d<distance){distance=d;closest=candidate}}
 return closest
}
function airspaceViewUnit(){
 if(!airspaceSpectating)return airspaceUnitFor(player);
 const allies=airspaceLiveUnits('blue');let unit=allies.find(u=>u.id===airspaceObservedId);
 if(!unit){unit=allies[0]||null;airspaceObservedId=unit?.id||null;cameraPoseInitialized=false}return unit
}
function cycleAirspaceSpectator(direction){
 if(!airspaceSpectating||!playing)return;
 const allies=airspaceLiveUnits('blue');if(!allies.length)return;
 const index=allies.findIndex(u=>u.id===airspaceObservedId),next=(Math.max(0,index)+direction+allies.length)%allies.length;
 airspaceObservedId=allies[next].id;resetCameraTracking();updateAirspaceHUD()
}
function enterAirspaceSpectator(){
 airspaceSpectating=true;clearFlightInputs();resetDuelBoundary();cursorTarget=null;stopEngineSound();stopGunSounds();resetCameraTracking();airspaceViewUnit();
 $('#hud').classList.add('spectating');$('#spectatorControls').classList.remove('hidden');$('#throttleControl').classList.add('hidden');
 for(const id of ['reticle','aimCursor','leadIndicator'])$('#'+id).style.display='none';
 $('#cursorStatus').classList.add('hidden');toast('战机已被击落 · 进入队友观战')
}
function damageAirspaceUnit(unit,amount,shooterId=null){
 if(!unit||unit.dead||!Number.isFinite(amount)||amount<=0||ended)return;
 unit.health=Math.max(0,unit.health-amount);
 if(unit.isPlayer){hp=unit.health;triggerDamageFlash()}
 if(unit.root===enemy)eHp=unit.health;
 if(unit.health<=0){
  unit.dead=true;unit.targetId=null;retireAircraft(unit.root);
  const shooter=airspaceUnits.find(u=>u.id===shooterId);
  if(shooter?.isPlayer&&shooter.team!==unit.team){kills++;$('#kills').textContent=String(kills).padStart(2,'0');playSfx('kill',.35);toast('敌机击落 · '+planeInfo[unit.type].name)}
  if(unit.isPlayer)enterAirspaceSpectator();
 }
}
function finishAirspaceBattle(winner){
 if(ended)return;
 airspaceState.winner=winner;resetDuelBoundary();battlePaused=false;clearFlightInputs();playing=false;ended=true;
 for(const unit of airspaceUnits)unit.root.userData.engineRunning=false;
 stopGunSounds();stopEngineSound();$('#spectatorControls').classList.add('hidden');$('#again').textContent='再次升空　→';
 $('#resultTitle').textContent=winner===null?'双方全灭':winner==='blue'?'空域争夺胜利':'空域争夺失败';
 const scores=airspaceState.scores,reason=winner===null?'双方载具均已被击落。':scores[winner]>=AIRSPACE_RULES.scoreToWin-1e-9?'据点积分达到100分。':'对方编队已被全歼。';
 $('#resultCopy').textContent=`${reason} 我方 ${Math.floor(scores.blue+1e-9)} : ${Math.floor(scores.red+1e-9)} 敌方 · 个人击落 ${kills} 架。`;
 updateAirspaceHUD();$('#end').classList.remove('hidden');settleSortieEconomy(winner===null?null:winner==='blue')
}
function airspaceNavigationGoal(unit,dt){
 const ammo=airspaceAmmoFraction(unit);
 if(!unit.resupplying&&(unit.health<unit.maxHealth*.45||ammo<.15))unit.resupplying=true;
 if(unit.resupplying&&unit.health>=unit.maxHealth*.95&&ammo>=.95)unit.resupplying=false;
 const center=unit.resupplying?airspaceState.bases[unit.team]:airspaceState.point,root=unit.root,data=root.userData,distance=root.position.distanceTo(center)*METERS_PER_UNIT;
 let goal=center.clone();
 if(distance<260){
  // A small orbit lets nimble aircraft accumulate capture and supply time.
  const radial=root.position.clone().sub(center).setY(0);if(radial.lengthSq()<.01)radial.set(unit.team==='blue'?1:-1,0,0);
  const tangent=new THREE.Vector3(-radial.z,0,radial.x).normalize();radial.normalize();
  goal.addScaledVector(radial,13).addScaledVector(tangent,13);goal.y=center.y;
 }
 const min=planeInfo[unit.type].minLevelFlightKmh,max=planeInfo[unit.type].maxSpeedKmh;
 data.airspaceNavigationThrottle=THREE.MathUtils.clamp((distance<650?min*1.4:max*.82)/max,.3,.9);
 return goal
}
function airspaceFlightDirection(root,goal){
 // A waypoint behind the aircraft commands a banked turn, with a separate,
 // gentle altitude correction. It must not command a pitch loop over the point.
 const data=root.userData,toGoal=goal.clone().sub(root.position),travel=data.velocity.clone().setY(0);
 if(travel.lengthSq()<.001)travel.set(0,0,-1).applyQuaternion(root.quaternion).setY(0);travel.normalize();
 const desired=toGoal.clone().setY(0);if(desired.lengthSq()<.001)desired.copy(travel);desired.normalize();
 const angle=Math.atan2(new THREE.Vector3().crossVectors(travel,desired).y,THREE.MathUtils.clamp(travel.dot(desired),-1,1));
 const headingLimit=Math.min(.14,turnRateForPlane(data.type,Math.max(data.airspeed,1))*.8);
 const direction=travel.applyAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.clamp(angle,-headingLimit,headingLimit));
 const speed=Math.max(data.airspeed,data.minFlightSpeedMps),climbFraction=Math.min(.22,data.bestClimbMps*.8/speed),slope=THREE.MathUtils.clamp(toGoal.y*METERS_PER_UNIT/Math.max(600,speed*4),-climbFraction,climbFraction);
 return direction.multiplyScalar(Math.sqrt(1-slope*slope)).setY(slope)
}
function updateAirspaceAI(unit,dt){
 const root=unit.root,data=root.userData,goal=airspaceNavigationGoal(unit,dt);unit.targetDecision-=dt;
 let target=airspaceUnits.find(u=>u.id===unit.targetId&&!u.dead);
 if(unit.targetDecision<=0||!target){
  const nearest=nearestAirspaceHostile(unit);
  if(!target||nearest&&root.position.distanceToSquared(nearest.root.position)<root.position.distanceToSquared(target.root.position)*.65)target=nearest;
  unit.targetId=target?.id||null;unit.targetDecision=.3+unit.index*.01;
 }
 const nearObjective=root.position.distanceTo(airspaceState.point)*METERS_PER_UNIT<650,enemyNearPoint=target&&target.root.position.distanceTo(airspaceState.point)*METERS_PER_UNIT<650;
 const targetRange=target?root.position.distanceTo(target.root.position)*METERS_PER_UNIT:Infinity;
 const combat=!unit.resupplying&&target&&(targetRange<850||enemyNearPoint&&nearObjective);
 if(unit.type!=='b29'&&target){
  updateFighterAI(root,target.root,airspaceState.point,dt,combat?null:goal);
 }else{
  data.throttle=data.airspaceNavigationThrottle;const safe=safeAIGoal(root,goal),boundary=duelBoundaryReturnGoal(root),direction=airspaceFlightDirection(root,boundary||safe);
  const steps=Math.max(1,Math.ceil(dt/FLIGHT_PHYSICS.stepSeconds)),step=dt/steps;
  for(let i=0;i<steps;i++){steerAircraftToward(root,direction,step);advanceAircraft(root,step);enforceDuelAIBoundary(root)}
 }
 if(unit.type==='b29')fireAirspaceBomberTurrets(unit,dt)
}
function fireAirspaceBomberTurrets(unit,dt){
 if(!unit||unit.dead||unit.type!=='b29')return;
 const root=unit.root,data=root.userData,ammo=unit.ammo;
 data.bomberArcCheckRemaining=(data.bomberArcCheckRemaining||0)-dt;
 if(data.bomberArcCheckRemaining<=0){
  data.bomberArcCheckRemaining=.075;data.airspaceTurretTargets=[];
  const inverse=root.quaternion.clone().invert(),hostiles=airspaceLiveUnits().filter(u=>u.team!==unit.team&&root.position.distanceToSquared(u.root.position)<26**2);
  for(const turret of B29_TURRETS){let chosen=null,closest=Infinity;
   for(const target of hostiles){const relative=target.root.position.clone().sub(root.position).applyQuaternion(inverse).sub(new THREE.Vector3(...turret.offset)),distance=relative.length()*METERS_PER_UNIT;
    if(distance<=250&&distance<closest&&bomberTurretCanTrack(turret,relative)&&terrainLineClear(root.position,target.root.position)){chosen=target;closest=distance}}
   if(chosen)data.airspaceTurretTargets.push({turret,target:chosen});
  }
 }
 const active=(data.airspaceTurretTargets||[]).filter(item=>!item.target.dead);
 if(!active.length||ammo.b29mg<=0){data.bomberGunsActive=false;data.bomberGunClock=0;return}
 data.bomberGunsActive=true;data.bomberGunClock+=dt;const interval=60/450;
 while(data.bomberGunClock>=interval&&ammo.b29mg>0){
  data.bomberGunClock-=interval;playGunShot('b29Gun',root,!unit.isPlayer,interval,true);
  for(const{turret,target}of active){const rounds=Math.min(turret.guns,ammo.b29mg);ammo.b29mg-=rounds;let hits=0;for(let n=0;n<rounds;n++)if(Math.random()<.5)hits++;if(hits&&!target.dead)damageAirspaceUnit(target,hits*20,unit.id)}
 }
}
// Return a segment entry fraction, so overlapping shot paths hit the closest enemy.
function airspaceHitFraction(start,end,root,radius){
 const half=root.userData.collisionHalfExtents;if(!half)return null;
 const previous=root.userData.frameStartPosition||root.position,movedStart=start.clone().add(root.position).sub(previous);
 const broadRadius=half.length()*Math.max(Math.abs(root.scale.x),Math.abs(root.scale.y),Math.abs(root.scale.z))+radius;
 const segment=end.clone().sub(movedStart),length=segment.lengthSq(),projection=length?THREE.MathUtils.clamp(root.position.clone().sub(movedStart).dot(segment)/length,0,1):0;
 if(movedStart.clone().addScaledVector(segment,projection).distanceToSquared(root.position)>broadRadius**2)return null;
 const a=root.worldToLocal(movedStart),b=root.worldToLocal(end.clone()),localRadius=radius/Math.max(.00001,Math.min(Math.abs(root.scale.x),Math.abs(root.scale.y),Math.abs(root.scale.z)));
 let enter=0,exit=1;
 for(const axis of ['x','y','z']){const extent=half[axis]+localRadius,delta=b[axis]-a[axis];if(Math.abs(delta)<1e-9){if(Math.abs(a[axis])>extent)return null;continue}let near=(-extent-a[axis])/delta,far=(extent-a[axis])/delta;if(near>far)[near,far]=[far,near];enter=Math.max(enter,near);exit=Math.min(exit,far);if(enter>exit)return null}
 return enter
}
function updateAirspaceBullets(dt){
 const live=airspaceLiveUnits();
 for(let i=bullets.length-1;i>=0;i--){const bullet=bullets[i];(bullet.previousPosition??=new THREE.Vector3()).copy(bullet.mesh.position);
  bullet.mesh.position.addScaledVector(bullet.dir,bullet.speed*Math.min(dt,Math.max(0,bullet.life)));bullet.life-=dt;
  let target=null,fraction=Infinity;
  for(const unit of live){if(unit.dead||unit.team===bullet.team)continue;const hit=airspaceHitFraction(bullet.previousPosition,bullet.mesh.position,unit.root,bullet.radius);if(hit!==null&&hit<fraction){fraction=hit;target=unit}}
  if(target)damageAirspaceUnit(target,bullet.damage,bullet.shooterId);
  if(target||bullet.life<=0||bullet.mesh.position.y<terrainHeightAt(bullet.mesh.position.x,bullet.mesh.position.z))releaseBullet(i)
 }
}
function updateAirspaceBombs(dt){
 for(let i=bombsInFlight.length-1;i>=0;i--){const bomb=bombsInFlight[i],start=bomb.mesh.position.clone();bomb.velocity.y-=9.81/METERS_PER_UNIT*dt;bomb.mesh.position.addScaledVector(bomb.velocity,dt);bomb.life-=dt;
  let target=null,fraction=Infinity;
  for(const unit of airspaceLiveUnits('red')){const hit=airspaceHitFraction(start,bomb.mesh.position,unit.root,bomb.radius);if(hit!==null&&hit<fraction){fraction=hit;target=unit}}
  if(target)damageAirspaceUnit(target,bomb.damage,airspaceUnitFor(player).id);
  if(target||bomb.life<=0||bomb.mesh.position.y<=terrainHeightAt(bomb.mesh.position.x,bomb.mesh.position.z)){scene.remove(bomb.mesh);bomb.mesh.geometry.dispose();bomb.mesh.material.dispose();bombsInFlight.splice(i,1)}
 }
}
function updateAirspaceStep(dt){
 if(playing)battleRewardSeconds+=dt;
 if(!playing||ended||!airspaceState)return;
 worldTime+=dt;rememberAircraftFrameStart();
 for(const unit of airspaceLiveUnits())updatePropeller(unit.root,dt);
 if(airspacePlayerAlive()){
  updatePlayerFlightControls(dt);updateCursorTarget(dt);fireWeapons(player,false,dt,keys.fire);
  if(keys.bomb&&!bombKeyWasDown)dropBomb();bombKeyWasDown=keys.bomb;fireAirspaceBomberTurrets(airspaceUnitFor(player),dt);
 }
 for(const unit of airspaceLiveUnits())if(!unit.isPlayer)updateAirspaceAI(unit,dt);
 for(const unit of airspaceLiveUnits())if(unit.root.position.y<=terrainHeightAt(unit.root.position.x,unit.root.position.z))damageAirspaceUnit(unit,unit.health);
 if(airspacePlayerAlive())updateDuelBoundary(dt);
 updateAirspaceBullets(dt);updateAirspaceBombs(dt);
 for(const unit of airspaceLiveUnits())replenishAirspaceUnit(unit,airspaceState.bases[unit.team],dt);
 if(airspacePlayerAlive())hp=airspaceUnitFor(player).health;
 advanceAirspaceObjective(airspaceState,airspaceUnits,dt);
 const winner=airspaceWinner(airspaceState,airspaceUnits);if(winner!==undefined)finishAirspaceBattle(winner)
}
function updateAirspaceFrame(elapsed,dt){
 if(elapsed>0)advanceAirspaceSimulation(elapsed);
 const hudDue=shouldUpdateBattleHUD(dt);
 const view=airspaceViewUnit();
 if(airspaceSpectating){if(view)updateAirspaceSpectatorCamera(view.root,dt)}else updateChaseCamera(dt);
 if(playing&&hudDue)updateAirspaceTacticalDisplay();if(hudDue)updateAirspaceHUD();
 if(view&&hudDue){const data=view.root.userData;$('#speed').textContent=Math.round(data.airspeed*3.6);$('#alt').textContent=Math.max(0,Math.round((view.root.position.y+90)*METERS_PER_UNIT))+' m';$('#aoa').textContent=(data.aoa*180/Math.PI).toFixed(1)+'°';$('#aoa').classList.toggle('warning',Math.abs(data.aoa)>14*Math.PI/180)}
 if(!airspaceSpectating){updateEngineAudio();if(hudDue){updateAmmoUI();updateHealthUI();updateEngineUI()}}
}
function updateAirspaceSpectatorCamera(root,dt){
 followCameraAnchor(root);
 if(!keys.look&&worldTime-cameraInputAt>=2){cameraOrbitYaw=THREE.MathUtils.damp(cameraOrbitYaw,0,2.8,dt);cameraOrbitPitch=THREE.MathUtils.damp(cameraOrbitPitch,0,2.8,dt)}
 const orbit=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),cameraOrbitYaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),cameraOrbitPitch)),pose=root.quaternion.clone().multiply(orbit),offset=chaseFrameOffsets(root.userData.type),position=root.position.clone().add(new THREE.Vector3(0,offset.heightMeters/METERS_PER_UNIT,offset.backMeters/METERS_PER_UNIT).applyQuaternion(pose));
 const target=root.position.clone().add(new THREE.Vector3(0,0,-100).applyQuaternion(pose)),look=new THREE.Matrix4().lookAt(position,target,new THREE.Vector3(0,1,0)),rotation=new THREE.Quaternion().setFromRotationMatrix(look);
 if(!cameraPoseInitialized){camera.position.copy(position);camera.quaternion.copy(rotation);cameraPoseInitialized=true}else{camera.position.lerp(position,1-Math.exp(-16*dt));camera.quaternion.slerp(rotation,1-Math.exp(-18*dt))}camera.updateMatrixWorld(true)
}
function updateAirspaceHealthUI(){
 const own=airspaceUnitFor(player),view=airspaceViewUnit();if(!own)return;
 $('#playerHealth').style.width=(own.health/own.maxHealth*100)+'%';$('#hpText').textContent=Math.round(own.health/own.maxHealth*100)+'%';
 const target=view&&nearestAirspaceHostile(view);enemy=target?.root||null;if(target){enemyPlaneType=target.type;eHp=target.health}
 $('#enemyHealth').style.width=(target?target.health/target.maxHealth*100:0)+'%';$('#targetName').textContent=target?'敌机 · '+planeInfo[target.type].name:'敌方编队已全灭'
}
function updateAirspaceHUD(){
 if(!airspaceState)return;
 const s=airspaceState,blue=airspaceLiveUnits('blue').length,red=airspaceLiveUnits('red').length;
 $('#blueAlive').textContent=blue;$('#redAlive').textContent=red;$('#blueScore').textContent=Math.floor(s.scores.blue+1e-9);$('#redScore').textContent=Math.floor(s.scores.red+1e-9);
 const owner=s.owner==='blue'?'我方占领':s.owner==='red'?'敌方占领':'中立';
 $('#aPointStatus').textContent='A · '+owner;$('#aCaptureBlue').style.width=(Math.max(0,s.progress)*50)+'%';$('#aCaptureRed').style.width=(Math.max(0,-s.progress)*50)+'%';
 const direction=Math.sign(s.counts.blue-s.counts.red),goal=direction>0?1:-1,remaining=direction?Math.max(0,Math.abs(goal-s.progress)*AIRSPACE_RULES.captureSeconds):0;
 $('#aCaptureText').textContent=`点内 ${s.counts.blue} : ${s.counts.red} · `+(direction&&remaining>.01?(direction>0?'我方':'敌方')+'占领 '+Math.ceil(remaining-1e-9)+'秒':direction?'占领完成':s.counts.blue||s.counts.red?'人数相等，进度暂停':'等待进入');
 $('#aPointStatus').style.color=s.owner==='blue'?'#76d5ff':s.owner==='red'?'#ff8580':'#ffcf71';
 const view=airspaceViewUnit();
 if(airspaceSpectating&&view){$('#spectatorLabel').textContent='观战 · '+planeInfo[view.type].name+' #'+(view.index+1)+' · '+Math.round(view.health/view.maxHealth*100)+'%';updateAirspaceHealthUI()}
 else if(!airspaceSpectating){const own=airspaceUnitFor(player),atBase=own&&!own.dead&&airspaceWithin(player.position,s.bases.blue,AIRSPACE_RULES.baseRadiusMeters);$('#baseSupplyStatus').textContent=atBase?'我方基地 · 生命与弹药补给中':'回我方基地补给 · 距离 '+Math.round(player.position.distanceTo(s.bases.blue)*METERS_PER_UNIT)+' m'}
}
function airspaceMarker(key,label,position,color,view){
 let node=airspaceMarkerNodes.get(key);if(!node){node=document.createElement('div');node.className='airspace-marker';node.innerHTML='<span class="marker-label"></span>';$('#airspaceMarkers').appendChild(node);airspaceMarkerNodes.set(key,node)}
 node.style.color=color;const anchor=projectEnemyMarkerPoint(position);node.classList.toggle('offscreen',!anchor.visible);node.style.left=(anchor.x/innerWidth*100)+'%';node.style.top=(anchor.y/innerHeight*100)+'%';
 node.querySelector('.marker-label').textContent=label+' · '+Math.round(position.distanceTo(view.root.position)*METERS_PER_UNIT)+' m';return node
}
function updateAirspaceTacticalDisplay(){
 const view=airspaceViewUnit();if(!view)return;camera.updateMatrixWorld(true);$('#enemyMarker').classList.add('hidden');$('#campaignEnemyMarkers').classList.add('hidden');
 const live=airspaceLiveUnits(),active=new Set(['A','base-blue','base-red']);
 // Spread the aircraft labels, leaving the objective and bases at their anchors.
 const occupied=[],offsets=[[0,0],[0,-28],[0,28],[65,0],[-65,0],[65,-28],[-65,-28],[65,28],[-65,28]];
 for(const unit of live)if(unit!==view){
  active.add(unit.id);const node=airspaceMarker(unit.id,(unit.team==='blue'?'友':'敌')+' '+planeInfo[unit.type].name+' #'+(unit.index+1),unit.root.position,unit.team==='blue'?'#76d5ff':'#ff8580',view),anchor=projectEnemyMarkerPoint(unit.root.position);
  if(anchor.visible){let x=anchor.x,y=anchor.y;for(const[dx,dy]of offsets){const nx=THREE.MathUtils.clamp(anchor.x+dx,24,innerWidth-24),ny=THREE.MathUtils.clamp(anchor.y+dy,innerHeight*.28,innerHeight-40);if(occupied.every(p=>Math.abs(nx-p.x)>62||Math.abs(ny-p.y)>24)&&Math.abs(nx-innerWidth*.5)+Math.abs(ny-innerHeight*.5)>38){x=nx;y=ny;break}}occupied.push({x,y});node.style.left=x/innerWidth*100+'%';node.style.top=y/innerHeight*100+'%'}
 }
 const owner=airspaceState.owner,aColor=owner==='blue'?'#76d5ff':owner==='red'?'#ff8580':'#ffcf71';
 airspaceMarker('A','A · '+Math.round((airspaceState.point.y+90)*METERS_PER_UNIT)+' m ALT',airspaceState.point,aColor,view);
 airspaceMarker('base-blue','我方基地',airspaceState.bases.blue,'#76d5ff',view);airspaceMarker('base-red','敌方基地',airspaceState.bases.red,'#ff8580',view);
 for(const[key,node]of airspaceMarkerNodes)if(!active.has(key)){node.remove();airspaceMarkerNodes.delete(key)}
 const canvas=$('#radar'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,cx=w/2,cy=h/2,extent=w*.43;
 ctx.clearRect(0,0,w,h);ctx.fillStyle='rgba(5,20,31,.8)';ctx.fillRect(0,0,w,h);ctx.strokeStyle='rgba(105,219,231,.43)';ctx.strokeRect(cx-extent,cy-extent,extent*2,extent*2);
 const plot=(position,color,label,size=2)=>{const x=cx+position.x/300*extent,y=cy+position.z/300*extent;ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,size,0,Math.PI*2);ctx.fill();if(label){ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.fillText(label,x,y-6)}};
 plot(airspaceState.point,aColor,'A',4);plot(airspaceState.bases.blue,'#76d5ff','友',4);plot(airspaceState.bases.red,'#ff8580','敌',4);
 for(const unit of live)plot(unit.root.position,unit===view?'#ffffff':unit.team==='blue'?'#76d5ff':'#ff8580',null,unit===view?3:2);
 $('#radarDistance').textContent='A '+Math.round(view.root.position.distanceTo(airspaceState.point)*METERS_PER_UNIT)+' m'
}

const CONTROL_SETTINGS_KEY='sky-duel.flight-controls.v1';
const DEFAULT_CONTROL_SETTINGS={mode:'cursor',sensitivity:1};
function loadControlSettings(){
 try{
  const saved=JSON.parse(localStorage.getItem(CONTROL_SETTINGS_KEY)||'null');
  return{mode:saved?.mode==='joystick'?'joystick':'cursor',sensitivity:THREE.MathUtils.clamp(Number.isFinite(saved?.sensitivity)?saved.sensitivity:1,.5,1.8)}
 }catch{return{...DEFAULT_CONTROL_SETTINGS}}
}
let controlSettings=loadControlSettings(),battlePaused=false,pausedEngineRunning=true;
let cursorDragPointer=null,cursorTarget=null,cursorCandidate=null,cursorCandidateSeconds=0,cursorOutsideSeconds=0;
const cursorDirectionWorld=new THREE.Vector3(0,0,-1),flightPointerClearers=[];
function controlModeName(){return controlSettings.mode==='cursor'?'瞄准环操作':'摇杆操作'}
function saveControlSettings(){try{localStorage.setItem(CONTROL_SETTINGS_KEY,JSON.stringify(controlSettings))}catch{}}
function renderControlSettings(){
 document.querySelectorAll('[name="flightControlMode"]').forEach(input=>{input.checked=input.value===controlSettings.mode});
 const slider=$('#cursorSensitivity');slider.value=controlSettings.sensitivity;slider.disabled=controlSettings.mode!=='cursor';
 $('#cursorSensitivityValue').textContent=controlSettings.sensitivity.toFixed(1)+'×';
 $('#homeControlMode').textContent=controlModeName();
 $('#controlInstructions').textContent=controlSettings.mode==='cursor'
  ?'拖动空白区域移动方向环，松手保持指向。飞机会逐渐转向，实际准星对准提前量圈后再射击。按住“观察”并拖动可自由观察。'
  :'左右移动摇杆进行滚转；向下拉杆抬头，向上推杆俯冲。松手停止操纵，拖动空白区域可自由观察。指向敌机显示预瞄点，实际准星对齐后开火。';
 applyControlModeUI()
}
function applyControlModeUI(){
 const isCursor=controlSettings.mode==='cursor';
 $('#joystick').classList.toggle('hidden',isCursor);
 $('#freeLook').classList.toggle('hidden',!isCursor);
 $('#cursorStatus').classList.remove('hidden');
 if(!isCursor)$('#aimCursor').style.display='none';
}
function clearFlightInputs(){
 flightPointerClearers.forEach(clear=>clear());
 for(const key of Object.keys(keys))keys[key]=false;
 joystickInput.x=0;joystickInput.y=0;filteredControlX=0;filteredControlY=0;
 cursorDragPointer=null;cameraDragPointer=null;
 $('#joystickKnob').style.transform='translate(-50%,-50%)';
 document.querySelectorAll('[data-key]').forEach(button=>button.classList.remove('on'))
}
function resetCursorControl(){
 cursorDragPointer=null;cursorTarget=null;cursorCandidate=null;cursorCandidateSeconds=0;cursorOutsideSeconds=0;
 if(player)cursorDirectionWorld.set(0,0,-1).applyQuaternion(player.quaternion).normalize();
 else cursorDirectionWorld.set(0,0,-1);
 $('#leadIndicator').style.display='none';applyControlModeUI()
}
function changeControlMode(mode){
 if(mode!=='cursor'&&mode!=='joystick')return;
 controlSettings.mode=mode;clearFlightInputs();resetCursorControl();
 if(player){player.userData.aiRollRate=0;player.userData.aiPitchRate=0;player.userData.bankRate=0;player.userData.verticalTurnRate=0;player.userData.flightAssist=mode==='cursor'}
 cameraPoseInitialized=false;saveControlSettings();renderControlSettings()
}
function moveCursorDirection(dx,dy,width=innerWidth,height=innerHeight){
 if(!Number.isFinite(dx)||!Number.isFinite(dy))return;
 const scale=THREE.MathUtils.degToRad(camera?.fov||63)*controlSettings.sensitivity*1.4/Math.max(height,1);
 const heading=Math.atan2(-cursorDirectionWorld.x,-cursorDirectionWorld.z)-dx*scale;
 const elevation=THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(cursorDirectionWorld.y,-1,1))-dy*scale,-Math.PI*5/12,Math.PI*5/12);
 cursorDirectionWorld.set(-Math.sin(heading)*Math.cos(elevation),Math.sin(elevation),-Math.cos(heading)*Math.cos(elevation)).normalize()
}
function updateCursorFlightControls(dt){
 const horizontal=(keys.right?1:0)-(keys.left?1:0),vertical=(keys.down?1:0)-(keys.up?1:0);
 if(horizontal||vertical)moveCursorDirection(horizontal*innerHeight*.55*dt,vertical*innerHeight*.55*dt);
 player.userData.flightAssist=true;
 const count=Math.max(1,Math.ceil(dt/FLIGHT_PHYSICS.stepSeconds)),step=dt/count;
 for(let i=0;i<count;i++){steerAircraftToward(player,cursorDirectionWorld,step);advanceAircraft(player,step)}
 return player.userData.airspeed
}
function cursorViewQuaternion(){
 const heading=Math.atan2(-cursorDirectionWorld.x,-cursorDirectionWorld.z),pitch=Math.asin(THREE.MathUtils.clamp(cursorDirectionWorld.y,-1,1));
 return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),heading)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),pitch))
}
function availableCursorTargets(){
 if(gameMode==='airspace')return airspacePlayerAlive()?airspaceLiveUnits('red').map(unit=>unit.root):[];

 return gameMode==='campaign'?campaignTargets().filter(t=>t.health>0).map(t=>t.root):(enemy&&eHp>0?[enemy]:[])
}
function updateCursorTarget(dt){
 if(gameMode==='airspace'&&!airspacePlayerAlive()){cursorTarget=null;return}

 if(!playing){cursorTarget=null;return}
 const targets=availableCursorTargets(),isCursor=controlSettings.mode==='cursor';
 if(cursorTarget&&!targets.includes(cursorTarget))cursorTarget=null;
 if(keys.look)return;
 const reference=isCursor?cursorDirectionWorld:new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion);
 let candidate=null,bestAngle=isCursor?.065:.40;
 for(const root of targets){
  const relative=root.position.clone().sub(player.position),distance=relative.length()*METERS_PER_UNIT;if(distance<20||distance>3500)continue;
  const angle=Math.acos(THREE.MathUtils.clamp(relative.normalize().dot(reference),-1,1));if(angle<bestAngle){bestAngle=angle;candidate=root}
 }
 if(candidate!==cursorCandidate){cursorCandidate=candidate;cursorCandidateSeconds=0}
 if(candidate){cursorCandidateSeconds+=dt;if(cursorCandidateSeconds>=.3){cursorTarget=candidate;cursorOutsideSeconds=0}}
 if(cursorTarget){
  const relative=cursorTarget.position.clone().sub(player.position),outside=relative.length()*METERS_PER_UNIT>4000||relative.normalize().dot(reference)<Math.cos(isCursor?.4:.75);
  cursorOutsideSeconds=outside?cursorOutsideSeconds+dt:0;if(cursorOutsideSeconds>.45){cursorTarget=null;cursorCandidate=null;cursorCandidateSeconds=0;cursorOutsideSeconds=0}
 }
}
function playerGunReference(){
 for(const id of selectedWeaponIds(playerPlane,weaponMode)){
  const spec=weaponInfo[playerPlane]?.[id];if(!spec)continue;
  const offset=new THREE.Vector3();spec.offsets.forEach(o=>offset.add(new THREE.Vector3(...o)));
  offset.divideScalar(spec.offsets.length).multiplyScalar(player.scale.x).applyQuaternion(player.quaternion);
  return{id,spec,origin:player.position.clone().add(offset)}
 }
 return null
}
function placeFlightMarker(node,worldPoint,edgeHint=false){
 const relative=worldPoint.clone().sub(camera.position),inFront=relative.dot(new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion))>0;
 const point=worldPoint.clone().project(camera),visible=inFront&&point.z>=-1&&point.z<=1&&Math.abs(point.x)<=.96&&Math.abs(point.y)<=.94;
 if(!visible&&!edgeHint){node.style.display='none';return false}
 if(!inFront){node.style.display='none';return false}
 node.style.display='block';node.classList.toggle('at-edge',!visible);
 node.style.left=((THREE.MathUtils.clamp(point.x,-.94,.94)+1)*.5*innerWidth)+'px';
 node.style.top=((1-THREE.MathUtils.clamp(point.y,-.92,.92))*.5*innerHeight)+'px';return visible
}
function updateFlightAimingHUD(){
 if(gameMode==='airspace'&&airspaceSpectating){for(const id of ['reticle','aimCursor','leadIndicator'])$('#'+id).style.display='none';$('#cursorStatus').classList.add('hidden');return}

 if(!player||!camera)return;
 const isCursor=controlSettings.mode==='cursor',gun=playerGunReference(),forward=new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion).normalize(),origin=gun?.origin||player.position,reticle=$('#reticle'),ring=$('#aimCursor'),lead=$('#leadIndicator'),status=$('#cursorStatus');
 if(gun)placeFlightMarker(reticle,origin.clone().addScaledVector(forward,100));else reticle.style.display='none';
 if(isCursor)placeFlightMarker(ring,player.position.clone().addScaledVector(cursorDirectionWorld,120),true);else ring.style.display='none';
 lead.style.display='none';status.classList.remove('hidden');
 const prefix=isCursor?'方向环操控':'摇杆操控';
 if(!gun){status.textContent=prefix+' · 炮塔自动防御';return}
 if(!cursorTarget){status.textContent=prefix+' · 指向敌机显示预瞄点';if(isCursor&&(player.userData.instructorRecovering||player.userData.instructorEnergyGuard))status.textContent+=' · 优先恢复速度';return}
 const targetName=planeInfo[cursorTarget.userData.type]?.name||'敌机',solution=solveBulletIntercept(gun.origin,cursorTarget.position,cursorTarget.userData.velocity,gun.spec.speed/METERS_PER_UNIT);
 if(!solution){status.textContent=targetName+' · 超出有效弹道';return}
 placeFlightMarker(lead,gun.origin.clone().addScaledVector(solution.direction,100));
 const angle=Math.acos(THREE.MathUtils.clamp(solution.direction.dot(forward),-1,1));lead.classList.toggle('aligned',angle<.015);
 const names={n37:'N-37',ns23:'NS-23',m2:'12.7 mm',mg762:'7.62 mm',hispano:'20 mm',mg:'机枪'};
 status.textContent=targetName+' · '+(names[gun.id]||'主武器')+'预瞄点'+(angle<.015?' · 准星已对齐':'')
}
function resumeBattle(){
 if(!battlePaused||ended)return;
 clearFlightInputs();battlePaused=false;playing=true;player.userData.engineRunning=airspacePlayerAlive()&&pausedEngineRunning;
 $('#end').classList.add('hidden');$('#again').textContent='再次升空　→';
 if(airspacePlayerAlive())startEngineSound(playerPlane);clock.getDelta();toast('继续战斗')
}

const MAP_LIBRARY={openSea:{name:'远洋空域',sizeMeters:22000},korea1951:{name:'1951·朝鲜',modelFile:'./korea-1951-terrain.glb',sizeMeters:6000}};
let activeMapId='openSea',groundPlane=null,mapSun=null,mapHemisphere=null,koreaTerrain=null,koreaTerrainPromise=null,koreaHeightGrid=null;
// Keep each GLB's correction, real dimensions, and collision envelope with its own spec.
const AIRCRAFT_SPECS={i16:{chaseOffsetMeters:8.7,chaseHeightMeters:3.5,modelFile:'./i16-type5.glb',lengthMeters:6.00,levelDragCompensation:.018,rollRateDps:185,control:{stickAttackSeconds:.045,stickReleaseSeconds:.060,rollResponse:13,rollRelease:14,pitchResponse:8},axisFlip:[1,1,1],collisionMeters:{x:9.00644950,y:2.96361132,z:6.00}},i15:{chaseOffsetMeters:9.3,chaseHeightMeters:3.9,modelFile:'./i15-soviet.glb',lengthMeters:6.10,levelDragCompensation:.018,rollRateDps:165,control:{stickAttackSeconds:.045,stickReleaseSeconds:.065,rollResponse:12,rollRelease:13,pitchResponse:8},axisFlip:[1,1,1],collisionMeters:{x:9.58293027,y:3.29077148,z:6.10}},mig3:{chaseOffsetMeters:9.5,chaseHeightMeters:4.3,modelFile:'./mig3.glb',lengthMeters:8.25,levelDragCompensation:.018,rollRateDps:120,control:{stickAttackSeconds:.06,stickReleaseSeconds:.08,rollResponse:9,rollRelease:11,pitchResponse:6.8},axisFlip:[1,1,1],collisionMeters:{x:10.231,y:3.287,z:8.25}},f3f2:{chaseOffsetMeters:8.7,chaseHeightMeters:3.5,modelFile:'./f3f2_yellow_wings.glb',lengthMeters:7.06,rollRateDps:145,levelDragCompensation:.018,highSpeedTurnDrag:.014,control:{stickAttackSeconds:.05,stickReleaseSeconds:.07,rollResponse:11,rollRelease:13,pitchResponse:8},axisFlip:[1,1,1],collisionMeters:{x:9.807017,y:2.81643,z:7.06}},i15bis:{chaseOffsetMeters:9.8,chaseHeightMeters:3.9,modelFile:'./taiwanese_i-15bis_animated.glb',lengthMeters:6.28,rollRateDps:160,control:{stickAttackSeconds:.045,stickReleaseSeconds:.065,rollResponse:12,rollRelease:13,pitchResponse:8},axisFlip:[-1,1,-1],collisionMeters:{x:10.2,y:3.4,z:6.28}},bf109b1:{chaseOffsetMeters:8,chaseHeightMeters:3.8,modelFile:'./bf_109_b-1_animated.glb',lengthMeters:8.55,rollRateDps:135,control:{stickAttackSeconds:.055,stickReleaseSeconds:.075,rollResponse:10,rollRelease:12,pitchResponse:7},axisFlip:[-1,1,-1],collisionMeters:{x:9.65,y:3.05,z:8.55}},p36a:{chaseOffsetMeters:8.9,chaseHeightMeters:4.2,modelFile:'./p36a_hawk.glb',lengthMeters:8.70,rollRateDps:105,control:{stickAttackSeconds:.065,stickReleaseSeconds:.08,rollResponse:8.5,rollRelease:10,pitchResponse:6.2},axisFlip:[-1,1,-1],collisionMeters:{x:10.58,y:3.69,z:8.70}},mig15:{chaseOffsetMeters:10.3,chaseHeightMeters:3.7,modelFile:'./mig15.glb',lengthMeters:10.10,rollRateDps:140,control:{stickAttackSeconds:.052,stickReleaseSeconds:.07,rollResponse:11,rollRelease:13,pitchResponse:7.3},axisFlip:[1,1,1],collisionMeters:{x:10.08,y:3.7,z:10.10}},f86:{chaseOffsetMeters:12,chaseHeightMeters:4.3,modelFile:'./f-86f-2_sabre_custom_war_thunder.glb',lengthMeters:11.4,rollRateDps:155,control:{stickAttackSeconds:.048,stickReleaseSeconds:.065,rollResponse:12,rollRelease:14,pitchResponse:7.8},axisFlip:[-1,1,-1],collisionMeters:{x:11.3,y:4.5,z:11.4}},meteor:{chaseOffsetMeters:11.4,chaseHeightMeters:4.4,modelFile:'./meteor_f_mk_4_g.41f_war_thunder.glb',lengthMeters:12.6,rollRateDps:125,control:{stickAttackSeconds:.06,stickReleaseSeconds:.075,rollResponse:9.5,rollRelease:11,pitchResponse:6.7},axisFlip:[-1,1,-1],collisionMeters:{x:13.2,y:3.0,z:12.6}},b29:{chaseOffsetMeters:42.9,chaseHeightMeters:15.5,modelFile:'./b29.glb',lengthMeters:30.18,rollRateDps:35,control:{stickAttackSeconds:.11,stickReleaseSeconds:.13,rollResponse:4.4,rollRelease:5,pitchResponse:3.4},axisFlip:[1,1,1],axisRotationY:-Math.PI/2,collisionMeters:{x:43.05,y:8.46,z:30.18}}};
// RPM and handedness are independent of the aircraft's flight controls.
const PROPELLER_SPECS={i16:{idleRpm:550,maxRpm:1900,direction:1,spoolUpSeconds:2.7,spoolDownSeconds:3.5,blurStartRpm:750,blurFullRpm:1200,radius:1.384},i15:{idleRpm:550,maxRpm:1900,direction:1,spoolUpSeconds:2.7,spoolDownSeconds:3.5,blurStartRpm:750,blurFullRpm:1200,radius:1.324},mig3:{idleRpm:600,maxRpm:2400,direction:1,spoolUpSeconds:2.7,spoolDownSeconds:3.5,blurStartRpm:850,blurFullRpm:1400,radius:1.50},f3f2:{idleRpm:550,maxRpm:1900,direction:1,spoolUpSeconds:2.8,spoolDownSeconds:3.7,blurStartRpm:800,blurFullRpm:1250,radius:1.40},i15bis:{idleRpm:550,maxRpm:1900,direction:1,spoolUpSeconds:2.7,spoolDownSeconds:3.5,blurStartRpm:750,blurFullRpm:1200,radius:1.365},bf109b1:{idleRpm:600,maxRpm:2300,direction:-1,spoolUpSeconds:3.2,spoolDownSeconds:4.2,blurStartRpm:850,blurFullRpm:1350,radius:1.546},p36a:{idleRpm:550,maxRpm:1900,direction:1,spoolUpSeconds:3,spoolDownSeconds:3.8,blurStartRpm:800,blurFullRpm:1250,radius:1.50}};
const BOMBER_LOADOUTS={'20x500':{count:20,eachLb:500},'40x500':{count:40,eachLb:500},'18x1000':{count:18,eachLb:1000},'8x2000':{count:8,eachLb:2000},'4x4000':{count:4,eachLb:4000}};
const PROFILE_KEY='sky-duel-profile-v1';let unlockedPlanes=[],selectedAircraft='i15',selectedBombPayload='18x1000',researchNation='all';
const AIRCRAFT_TREE={i16:{nation:'ussr',nationName:'苏系',rating:1.3,rank:'I',branch:'单发战斗机'},i15:{nation:'ussr',nationName:'苏系',rating:1.0,rank:'I',branch:'双翼战斗机'},mig3:{nation:'ussr',nationName:'苏系',rating:2.3,rank:'II',branch:'单发战斗机'},f3f2:{nation:'us',nationName:'美系',rating:1.3,rank:'I',branch:'双翼战斗机'},bf109b1:{nation:'de',nationName:'德系',rating:1.3,rank:'I',branch:'单发战斗机'},i15bis:{nation:'cn',nationName:'中系',rating:1.0,rank:'I',branch:'双翼战斗机'},f86:{nation:'us',nationName:'美系',rating:8.0,rank:'V',branch:'喷气战斗机'},mig15:{nation:'ussr',nationName:'苏系',rating:8.0,rank:'V',branch:'喷气战斗机'},meteor:{nation:'uk',nationName:'英系',rating:8.0,rank:'V',branch:'喷气战斗机'},b29:{nation:'us',nationName:'美系',rating:6.7,rank:'IV',branch:'重型轰炸机'},p36a:{nation:'us',nationName:'美系',rating:1.3,rank:'I',branch:'单发战斗机'}};
const DUEL_RATING_RANGE=1.0;
function duelOpponentsFor(type){const rating=AIRCRAFT_TREE[type]?.rating;if(!Number.isFinite(rating))return[];return Object.keys(AIRCRAFT_TREE).filter(candidate=>Math.abs(AIRCRAFT_TREE[candidate].rating-rating)<=DUEL_RATING_RANGE+1e-9)}
function chooseDuelOpponent(type,random=Math.random){const eligible=duelOpponentsFor(type);if(!eligible.length)throw new Error('没有符合权重范围的对手：'+type);return eligible[Math.min(eligible.length-1,Math.floor(random()*eligible.length))]}
const B29_TURRETS=[{id:'frontUpper',name:'前上炮塔',guns:4,offset:[0,.16,-.62],yawCenterDeg:0,yawHalfDeg:90,minElevationDeg:-2.5,maxElevationDeg:90},{id:'rearUpper',name:'后上炮塔',guns:2,offset:[0,.16,.56],yawCenterDeg:180,yawHalfDeg:90,minElevationDeg:0,maxElevationDeg:90},{id:'frontLower',name:'前下炮塔',guns:2,offset:[0,-.17,-.56],yawCenterDeg:0,yawHalfDeg:90,minElevationDeg:-90,maxElevationDeg:5},{id:'rearLower',name:'后下炮塔',guns:2,offset:[0,-.17,.54],yawCenterDeg:180,yawHalfDeg:90,minElevationDeg:-90,maxElevationDeg:5},{id:'tail',name:'尾炮塔',guns:2,offset:[0,.02,1.42],yawCenterDeg:180,yawHalfDeg:30,minElevationDeg:-30,maxElevationDeg:30}];
function bomberTurretCanTrack(turret,local){const horizontal=Math.hypot(local.x,local.z),elevation=Math.atan2(local.y,horizontal)*180/Math.PI,yaw=horizontal<1e-4?turret.yawCenterDeg:Math.atan2(local.x,-local.z)*180/Math.PI,delta=((yaw-turret.yawCenterDeg+540)%360)-180;return Math.abs(delta)<=turret.yawHalfDeg+.001&&elevation>=turret.minElevationDeg-.001&&elevation<=turret.maxElevationDeg+.001;}
const blueSpawn=new THREE.Vector3(0,60,SPAWN_DISTANCE_METERS/(2*METERS_PER_UNIT)),redSpawn=new THREE.Vector3(0,60,-SPAWN_DISTANCE_METERS/(2*METERS_PER_UNIT));
const mat=(color,rough=.65,metal=.1)=>new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal,flatShading:true});
const planeInfo={i16:{name:'I-16 type 5',health:350,maxSpeedKmh:445,minLevelFlightKmh:118,bestClimbMps:13.4,turnTimeS:17.8,horizontalTurnRateDps:360/17.8,verticalTurnTimeS:9.8,verticalTurnRateDps:360/9.8,turnRadiusM:165,intro:'早期量产型伊-16，M-25A发动机，机体比24型更短；滚转性能优异，水平缠斗强；动力弱于后期型号，极速有限，俯冲不能过快，适合中低空作战。',specs:[['系别','苏联'],['等级','I'],['战机权重','1.3'],['机体耐久','350'],['最大航速','445 km/h'],['最小航速','118 km/h'],['最佳爬升率','13.4 m/s'],['水平转弯性能','17.8秒'],['垂直转弯性能','9.8秒'],['7.62mm ShKAS施卡斯机枪','机头2挺 · 合计备弹850发 · 单管1800发/分钟 · 伤害16 · 弹速825 m/s']]},i15:{name:'I-15',health:340,maxSpeedKmh:365,minLevelFlightKmh:105,bestClimbMps:12.7,turnTimeS:13.8,horizontalTurnRateDps:360/13.8,verticalTurnTimeS:8.6,verticalTurnRateDps:360/8.6,turnRadiusM:130,intro:'经典海鸥翼双翼战斗机，拥有极强的水平缠斗能力，回转极为灵活；采用固定起落架，极速不高，高空性能弱，适合低空低速狗斗，不适合高速俯冲交战，西班牙内战大量使用。',specs:[['系别','苏联'],['等级','I'],['战机权重','1.0'],['机体耐久','340'],['最大航速','365 km/h'],['最小航速','105 km/h'],['最佳爬升率','12.7 m/s'],['水平转弯性能','13.8秒'],['垂直转弯性能','8.6秒'],['7.62mm PV-1航空机枪','4挺 · 总备弹3200发 · 单管750发/分钟 · 伤害13 · 弹速775 m/s']]},mig3:{name:'MiG-3',health:480,maxSpeedKmh:640,minLevelFlightKmh:155,bestClimbMps:15.8,turnTimeS:24,horizontalTurnRateDps:360/24,verticalTurnTimeS:13.2,verticalTurnRateDps:360/13.2,turnRadiusM:300,intro:'二战苏联高空拦截战斗机，高空极速优秀，擅长万米高度拦截轰炸机；低空水平盘旋性能较差，发动机脆弱，适合抢占高度后俯冲攻击，避免长时间水平狗斗。',specs:[['系别','苏联'],['等级','II'],['战机权重','2.3'],['机体耐久','480'],['最大航速','640 km/h'],['最小航速','155 km/h'],['最佳爬升率','15.8 m/s'],['水平转弯性能','24秒'],['垂直转弯性能','13.2秒'],['12.7mm UBS别列津机枪','1挺 · 备弹280发 · 1000发/分钟 · 伤害28 · 弹速860 m/s'],['7.62mm ShKAS施卡斯机枪','2挺 · 合计备弹1500发 · 单管1800发/分钟 · 伤害15 · 弹速820 m/s']]},f3f2:{name:'F3F-2',health:360,maxSpeedKmh:425,minLevelFlightKmh:118,bestClimbMps:14.0,turnTimeS:16.5,horizontalTurnRateDps:360/16.5,verticalTurnTimeS:10.1,verticalTurnRateDps:360/10.1,turnRadiusM:145,intro:'美军末代舰载双翼战斗机，拥有极为优秀的水平盘旋能力，低空机动灵活；极速偏低，高速下能量损耗严重，适合低速缠斗，不适合与高速单翼机进行俯冲交战。',specs:[['系别','美国'],['战机权重','美系 1.3'],['机体耐久','360'],['机长','7.06 m'],['最大航速','425 km/h'],['最小航速','118 km/h'],['最佳爬升率','14.0 m/s'],['水平转弯性能','16.5 s · 21.82°/s'],['垂直转弯性能','10.1 s · 35.64°/s'],['武器','1挺 12.7 mm M2勃朗宁 + 1挺 7.62 mm勃朗宁'],['备弹','M2：200发；7.62 mm：500发'],['射速','M2：750发/分；7.62 mm：1000发/分'],['单发伤害','M2：34；7.62 mm：13'],['弹速','M2：860 m/s；7.62 mm：810 m/s']]},
 i15bis:{name:'I-15bis',health:320,maxSpeedKmh:380,minLevelFlightKmh:112,bestClimbMps:14.2,turnTimeS:14.88,horizontalTurnRateDps:24.2,verticalTurnRateDps:26,turnRadiusM:250,intro:'早期双翼战斗机，低速盘旋性能极强，速度平庸，高空性能较差。四挺 PV-1 机枪适合近距狗斗。',specs:[['战机权重','中系 1.0'],['机体耐久','320'],['机长','6.28 m'],['最大航速','380 km/h'],['最小航速','112 km/h'],['最佳爬升率','14.2 m/s'],['水平转弯性能','24.2°/s · 360° 14.88 s · 半径 约250 m'],['垂直转弯性能','26.0°/s'],['武器','4挺 7.62 mm PV-1 机枪'],['总备弹','3050发 · 四挺合计'],['射速','每挺750发/分'],['单发伤害','13'],['弹速','820 m/s']]},
 p36a:{name:'P-36A',health:320,maxSpeedKmh:504,minLevelFlightKmh:120,bestClimbMps:14.0,turnTimeS:17.14,horizontalTurnRateDps:21,verticalTurnRateDps:22.5,turnRadiusM:300,intro:'三十年代后期的单翼战斗机，盘旋性能优秀，水平狗斗强势；武器配置较弱，高空功率衰减明显，适合中低空缠斗。',specs:[['系别','美国'],['战机权重','美系 1.3'],['机体耐久','320'],['机长','8.70 m'],['最大航速','504 km/h'],['最小航速','120 km/h'],['最佳爬升率','14.0 m/s'],['水平转弯性能','21.0°/s'],['垂直转弯性能','22.5°/s'],['武器','1挺 12.7 mm M2勃朗宁 + 1挺 7.62 mm勃朗宁'],['备弹','M2：200发；7.62 mm：500发'],['射速','M2：750发/分；7.62 mm：1000发/分'],['单发伤害','M2：32；7.62 mm：14'],['弹速','M2：860 m/s；7.62 mm：810 m/s']]},
 bf109b1:{name:'Bf-109 B-1',health:310,maxSpeedKmh:465,minLevelFlightKmh:135,bestClimbMps:13.2,turnTimeS:23.08,horizontalTurnRateDps:15.6,verticalTurnRateDps:19,turnRadiusM:300,intro:'早期Bf-109，搭载Jumo-210D发动机，火力偏弱，以能量战术为主。水平盘旋一般，高速性能尚可；仅有机鼻机枪，无机翼机枪。',specs:[['战机权重','德系 1.3'],['机体耐久','310'],['机长','8.55 m'],['最大航速','465 km/h'],['最小航速','135 km/h'],['最佳爬升率','13.2 m/s'],['水平转弯性能','15.6°/s'],['垂直转弯性能','19.0°/s'],['武器','2挺 7.92 mm MG-17机枪（机鼻）'],['总备弹','1000发 · 两挺合计'],['射速','每挺1200发/分'],['单发伤害','14'],['弹速','790 m/s']]},
 mig15:{name:'MIG-15',health:600,maxSpeedKmh:1076,minLevelFlightKmh:220,bestClimbMps:50,turnTimeS:20.7,horizontalTurnRateDps:17.3,verticalTurnRateDps:22,turnRadiusM:245,intro:'苏联早期后掠翼喷气式战斗机。机鼻集中安装大口径航炮，单次命中威力大。',specs:[['机体耐久','600'],['最大航速','1076 km/h'],['最小航速','220 km/h'],['最佳爬升率','50 m/s'],['水平转弯性能','360° 20.7 s · 17.3°/s · 半径 245 m'],['垂直转弯性能','22°/s'],['37 mm N-37','1门 · 备弹40 · 400发/分 · 伤害304 · 弹速690 m/s'],['23 mm NS-23','2门 · 总备弹160 · 每门550发/分 · 伤害106 · 弹速610 m/s'],['射击模式','N-37 / 双NS-23 / 三炮齐射']]},
 f86:{name:'F-86 佩刀',health:700,maxSpeedKmh:1106,minLevelFlightKmh:240,bestClimbMps:46.7,turnTimeS:24,horizontalTurnRateDps:15,verticalTurnRateDps:25,turnRadiusM:310,intro:'美国早期喷气式战斗机，六挺勃朗宁机枪形成密集弹幕。',specs:[['机体耐久','700'],['最大航速','1106 km/h'],['最小航速','240 km/h'],['最佳爬升率','46.7 m/s'],['水平转弯性能','360° 24.0 s · 15°/s · 半径 310 m'],['垂直转弯性能','25°/s'],['武器','6挺 12.7 mm 勃朗宁机枪'],['总备弹','1800发 · 6挺合计'],['射速','每挺600发/分'],['单发伤害','34'],['弹速','945 m/s']]},
 meteor:{name:'Meteor F Mk 4 G.41G',health:560,maxSpeedKmh:912,minLevelFlightKmh:290,bestClimbMps:30.9,turnTimeS:20,horizontalTurnRateDps:18,verticalTurnRateDps:20.5,turnRadiusM:282,intro:'英国系短翼流星 F.4 喷气式战斗机，四门 Hispano Mk.II 20 mm 机炮。',specs:[['战机权重','8.0'],['机体耐久','560'],['机长','12.6 m'],['最大航速','912 km/h'],['最小航速','290 km/h'],['最佳爬升率','30.9 m/s'],['水平转弯性能','360° 20.0 s · 18°/s · 半径 282 m'],['垂直转弯性能','20.5°/s'],['武器','4门 20 mm Hispano Mk.II'],['总备弹','720发 · 每门180发'],['射速','每门600发/分'],['单发伤害','85'],['弹速','880 m/s']]},
 b29:{name:'B-29 超级堡垒',health:1200,maxSpeedKmh:575,minLevelFlightKmh:180,bestClimbMps:8.5,turnTimeS:85.7,horizontalTurnRateDps:4.2,verticalTurnRateDps:5.5,turnRadiusM:1150,intro:'美系重型战略轰炸机。5座炮塔共12挺12.7 mm机枪，敌机进入250 m且落入对应射界时自动射击；炮塔不能手动操控。载弹量可在仓库调整。',specs:[['战机权重','美系 6.7'],['机体耐久','1200'],['机长','30.18 m'],['最大航速','575 km/h'],['最小航速','180 km/h'],['最佳爬升率','8.5 m/s'],['水平转弯性能','360° 约85.7 s · 4.2°/s · 半径 1150 m'],['垂直转弯性能','5.5°/s'],['防御武器','5座炮塔 · 12挺 12.7 mm机枪'],['前上炮塔','4挺 · 前半球上方，下俯限2.5°'],['后上炮塔','2挺 · 后半球水平线以上'],['前下炮塔','2挺 · 前半球下方，仰角限5°'],['后下炮塔','2挺 · 后半球下方，仰角限5°'],['尾炮塔','2挺 · 后向±30°，俯仰±30°'],['射速','每挺450发/分'],['单发伤害','20'],['机枪弹速','945 m/s'],['命中率','约50%'],['自动开火距离','250 m'],['机枪备弹','12000发 · 炮塔自动使用'],['炸弹挂载','20×500 / 40×500 / 18×1000 / 8×2000 / 4×4000 磅']]}
};
const weaponInfo={i16:{mg:{rpm:1800,damage:16,speed:825,cost:2,count:2,radius:.06,color:0xffdf96,offsets:[[-.018,.027,-.246],[.018,.027,-.246]]}},i15:{mg:{rpm:750,damage:13,speed:775,cost:4,count:4,radius:.07,color:0xffdf96,offsets:[[-.032,.026,-.235],[-.032,-.014,-.235],[.032,.026,-.235],[.032,-.014,-.235]]}},mig3:{m2:{rpm:1000,damage:28,speed:860,cost:1,count:1,radius:.08,color:0xffdf96,offsets:[[0,.047,-.29]]},mg762:{rpm:1800,damage:15,speed:820,cost:2,count:2,radius:.06,color:0xffdf96,offsets:[[-.019,.04,-.29],[.019,.04,-.29]]}},f3f2:{m2:{rpm:750,damage:34,speed:860,cost:1,count:1,radius:.08,color:0xffdf96,offsets:[[.018,-.040,-.30]]},mg762:{rpm:1000,damage:13,speed:810,cost:1,count:1,radius:.06,color:0xffdf96,offsets:[[-.018,-.040,-.30]]}},p36a:{m2:{rpm:750,damage:32,speed:860,cost:1,count:1,radius:.08,color:0xffdf96,offsets:[[.018,.005,-.36]]},mg762:{rpm:1000,damage:14,speed:810,cost:1,count:1,radius:.06,color:0xffdf96,offsets:[[-.018,.005,-.36]]}},i15bis:{mg:{rpm:750,damage:13,speed:820,cost:4,count:4,radius:.07,color:0xffdf96,offsets:[[-.22,-.015,-.27],[-.08,-.015,-.30],[.08,-.015,-.30],[.22,-.015,-.27]]}},bf109b1:{mg:{rpm:1200,damage:14,speed:790,cost:2,count:2,radius:.075,color:0xffe4ae,offsets:[[-.078,-.018,-.35],[.078,-.018,-.35]]}},f86:{mg:{rpm:600,damage:34,speed:945,cost:6,count:6,radius:.09,color:0x9df4ff,offsets:[[-.245,-.008,-.135],[-.205,-.008,-.11],[-.165,-.008,-.085],[.165,-.008,-.085],[.205,-.008,-.11],[.245,-.008,-.135]]}},mig15:{n37:{rpm:400,damage:304,speed:690,cost:1,count:1,radius:.22,color:0xffd36e,offsets:[[0,-.01,-.55]]},ns23:{rpm:550,damage:106,speed:610,cost:2,count:2,radius:.16,color:0xffef9b,offsets:[[-.032,-.01,-.53],[.032,-.01,-.53]]}},meteor:{hispano:{rpm:600,damage:85,speed:880,cost:4,count:4,radius:.15,color:0xffef9b,offsets:[[-.32,-.01,-.4],[-.24,-.01,-.42],[.24,-.01,-.42],[.32,-.01,-.4]]}}};
const AI_TACTICS={maxAltitudeMeters:3000,decisionSeconds:.15,minStateSeconds:{GUARD:.4,INTERCEPT:.55,ALIGN:.35,FIRE_PASS:.45,BREAK:1.5,REJOIN:1.1,RECOVER:1.0},escortLeashMeters:1400,escortReturnTriggerMeters:1100,escortEngageMeters:1050,escortTargetExitMeters:1250,escortReturnMeters:750,groundClearanceMeters:260,recoveryEnterDot:.42,recoveryExitDot:.90,recoveryEnterSeconds:.3,recoveryStableSeconds:.4};
const AI_FIGHTER={i16:{detectMeters:2500,loseMeters:3000,alignMeters:660,breakMeters:110,passSeconds:2.6,gun:{mg:{rangeMeters:540,coneDeg:6.3}}},i15:{detectMeters:2350,loseMeters:2850,alignMeters:600,breakMeters:100,passSeconds:2.7,gun:{mg:{rangeMeters:500,coneDeg:6.5}}},mig3:{detectMeters:2500,loseMeters:3000,alignMeters:750,breakMeters:130,passSeconds:2.7,gun:{m2:{rangeMeters:600,coneDeg:6},mg762:{rangeMeters:550,coneDeg:6.5}}},f3f2:{detectMeters:2350,loseMeters:2850,alignMeters:600,breakMeters:100,passSeconds:2.5,gun:{m2:{rangeMeters:520,coneDeg:6.5},mg762:{rangeMeters:480,coneDeg:6.8}}},p36a:{detectMeters:2350,loseMeters:2850,alignMeters:650,breakMeters:115,passSeconds:2.8,gun:{m2:{rangeMeters:520,coneDeg:6.5},mg762:{rangeMeters:480,coneDeg:6.8}}},bf109b1:{detectMeters:2450,loseMeters:2900,alignMeters:700,breakMeters:120,passSeconds:2.6,gun:{mg:{rangeMeters:550,coneDeg:6}}},i15bis:{detectMeters:2400,loseMeters:2900,alignMeters:640,breakMeters:110,passSeconds:2.7,gun:{mg:{rangeMeters:520,coneDeg:6.5}}},mig15:{detectMeters:3000,loseMeters:3500,alignMeters:870,breakMeters:150,passSeconds:2.8,gun:{n37:{rangeMeters:630,coneDeg:4.2},ns23:{rangeMeters:710,coneDeg:5.2}}},f86:{detectMeters:3000,loseMeters:3500,alignMeters:900,breakMeters:150,passSeconds:2.8,gun:{mg:{rangeMeters:760,coneDeg:5.4}}},meteor:{detectMeters:2800,loseMeters:3300,alignMeters:840,breakMeters:140,passSeconds:2.7,gun:{hispano:{rangeMeters:700,coneDeg:5.2}}}};
const AI_DUEL_CENTER=new THREE.Vector3(0,60,0);


const planeDracoLoader=new DRACOLoader();planeDracoLoader.setDecoderPath('./draco/');
const planeModelLoader=new GLTFLoader();planeModelLoader.setDRACOLoader(planeDracoLoader);
const planeModelPromises={};
function loadPlaneModel(type){const spec=AIRCRAFT_SPECS[type];if(!spec)throw new Error('未知飞机型号：'+type);if(!planeModelPromises[type])planeModelPromises[type]=planeModelLoader.loadAsync(spec.modelFile).then(gltf=>gltf.scene).catch(error=>{console.error('无法加载飞机模型：'+type,error);throw error});return planeModelPromises[type]}
const wreckedAircraft=[];let propellerBlurTexture=null;
function makePropellerBlurTexture(){
 if(propellerBlurTexture)return propellerBlurTexture;
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
 const context=canvas.getContext('2d'),pixels=context.createImageData(256,256);
 const smooth=(a,b,value)=>{const t=THREE.MathUtils.clamp((value-a)/(b-a),0,1);return t*t*(3-2*t)};
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){
  const dx=(x-127.5)/127.5,dy=(y-127.5)/127.5,r=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);
  const rim=smooth(.16,.29,r)*(1-smooth(.87,1,r)),streak=Math.pow(Math.max(0,Math.cos(2*angle+10*r)),10);
  const alpha=rim*(.22+.18*streak+.055*Math.cos(14*angle-4*r)**2),i=(y*256+x)*4;
  pixels.data[i]=190;pixels.data[i+1]=204;pixels.data[i+2]=204;pixels.data[i+3]=Math.round(255*alpha)
 }
 context.putImageData(pixels,0,0);propellerBlurTexture=new THREE.CanvasTexture(canvas);return propellerBlurTexture
}
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

function attachPropeller(root,source,spec){
 const settings=PROPELLER_SPECS[root.userData.type];if(!settings)return;
 const type=root.userData.type;
 let pivot=source.getObjectByName('PropellerPivot'),blades=pivot?.getObjectByName('PropellerBlades');
 if(type==='p36a'){pivot=source.getObjectByName('prop_49');blades=pivot?.children.filter(node=>node.isMesh)||[]}
 if(type==='i15'||type==='i16'){
  const authored=source.getObjectByName('prop01_1');if(!authored)throw new Error('缺少 I-15 螺旋桨');
  const center=new THREE.Box3().setFromObject(authored).getCenter(new THREE.Vector3());authored.parent.worldToLocal(center);
  pivot=new THREE.Group();pivot.name='PropellerPivot';pivot.position.copy(center);authored.parent.add(pivot);pivot.attach(authored);blades=[authored]
 }
 if(type==='f3f2'){
  const authored=source.getObjectByName('prop01_1');if(!authored)throw new Error('缺少 F3F-2 螺旋桨');
  pivot=new THREE.Group();pivot.name='PropellerPivot';pivot.position.set(0,-.292092,-2.30);
  authored.parent.add(pivot);pivot.attach(authored);blades=[authored]
 }
 if(!pivot||!blades||(Array.isArray(blades)&&!blades.length))throw new Error('缺少螺旋桨旋转节点：'+type);
 const scaled=['i16','i15','p36a','f3f2','mig3'].includes(type),worldScale=scaled?pivot.getWorldScale(new THREE.Vector3()):null;
 const discRadius=scaled?settings.radius/METERS_PER_UNIT/Math.max(Math.abs(worldScale.x),.0001):settings.radius;
 const disc=new THREE.Mesh(new THREE.PlaneGeometry(discRadius*2,discRadius*2),new THREE.MeshBasicMaterial({map:makePropellerBlurTexture(),transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
 disc.name='PropellerMotionBlur';if(type==='i16'||type==='i15'||type==='f3f2'||type==='mig3')disc.position.z=-.015;else{disc.rotation.x=Math.PI/2;disc.position.y=-.015}
 disc.visible=false;disc.renderOrder=2;pivot.add(disc);
 const spinAxis=type==='i16'||type==='i15'||type==='f3f2'||type==='mig3'?new THREE.Vector3(0,0,-1):new THREE.Vector3(0,1,0);
 root.userData.propeller={pivot,blades,disc,baseQuaternion:pivot.quaternion.clone(),spinQuaternion:new THREE.Quaternion(),spinAxis};
 root.userData.propeller.spinQuaternion.setFromAxisAngle(spinAxis,root.userData.propPhase||0);pivot.quaternion.copy(root.userData.propeller.baseQuaternion).multiply(root.userData.propeller.spinQuaternion)
}

function updatePropeller(root,dt){
 if(!root)return;const data=root.userData,spec=PROPELLER_SPECS[data.type];if(!spec)return;
 const desired=data.engineRunning&&!data.destroyed?spec.idleRpm+(spec.maxRpm-spec.idleRpm)*THREE.MathUtils.clamp(data.throttle??0,0,1):0;
 const difference=desired-data.propRpm,limit=(difference>=0?spec.maxRpm/spec.spoolUpSeconds:spec.maxRpm/spec.spoolDownSeconds)*dt;
 data.propRpm+=THREE.MathUtils.clamp(difference,-limit,limit);
 if(data.propRpm<.001)data.propRpm=0;
 data.propPhase=(data.propPhase+spec.direction*data.propRpm*Math.PI/30*dt)%(Math.PI*2);
 if(data.propeller){
  const {pivot,blades,disc}=data.propeller,blur=THREE.MathUtils.smoothstep(data.propRpm,spec.blurStartRpm,spec.blurFullRpm);
  const propData=data.propeller;propData.spinQuaternion.setFromAxisAngle(propData.spinAxis,data.propPhase);pivot.quaternion.copy(propData.baseQuaternion).multiply(propData.spinQuaternion);if(Array.isArray(blades))blades.forEach(blade=>blade.visible=blur<.96);else blades.visible=blur<.96;disc.visible=blur>.01;disc.material.opacity=.85*blur
 }
}
function updateAllPropellers(dt){
 if(gameMode!=='airspace'){updatePropeller(player,dt);updatePropeller(enemy,dt);for(const target of campaignBombers)updatePropeller(target.root,dt);for(const target of campaignEscorts)updatePropeller(target.root,dt)}
 if(gameMode==='airspace'&&battlePaused)return;
 for(let i=wreckedAircraft.length-1;i>=0;i--){
  const wreck=wreckedAircraft[i];updatePropeller(wreck.root,dt);wreck.life-=dt;
  wreck.root.position.addScaledVector(wreck.root.userData.velocity,dt*.45);
  wreck.root.position.y-=dt*.6;
  if(wreck.life<=0&&wreck.root.userData.propRpm===0){scene.remove(wreck.root);wreckedAircraft.splice(i,1)}
 }
}
function retireAircraft(root){
 if(!root)return;root.userData.engineRunning=false;root.userData.destroyed=true;
 if(PROPELLER_SPECS[root.userData.type])wreckedAircraft.push({root,life:5});else scene.remove(root)
}
function aircraft(isPlayer,type,options={}){
 const root=new THREE.Group(),spec=AIRCRAFT_SPECS[type],lengthMeters=spec.lengthMeters,collision=spec.collisionMeters;
 const info=planeInfo[type],maxSpeedMps=info.maxSpeedKmh/3.6,minFlightSpeedMps=info.minLevelFlightKmh/3.6,initialAirspeedMps=Math.max(minFlightSpeedMps*1.12,maxSpeedMps*.68);
 root.userData={isPlayer,modelContext:options.preview?'preview':'combat',type,lengthMeters,maxSpeedMps,minFlightSpeedMps,bestClimbMps:info.bestClimbMps,throttle:isPlayer?throttleValue:.76,engineRunning:false,destroyed:false,propRpm:0,propPhase:0,velocity:new THREE.Vector3(0,0,-initialAirspeedMps/METERS_PER_UNIT),aoa:0,airspeed:initialAirspeedMps,bomberGunClock:0,bomberGunsActive:false,collisionHalfExtents:new THREE.Vector3(collision.x,collision.y,collision.z).multiplyScalar(.5/METERS_PER_UNIT)};
 loadPlaneModel(type).then(source=>{
  if(root.userData.modelAttached)return;
  const model=new THREE.Group();
  model.add(source.clone(true));
  // The Meteor GLB already contains a Sketchfab Z-up to Y-up node transform; its source -Y nose arrives along +Z.
  // A 180-degree yaw flips X/Z into the game axes without distorting its native wingspan-to-length ratio.
  // 1) Correct this GLB's axes before measuring it.
  model.rotation.set(spec.axisRotationX||0,spec.axisRotationY||0,spec.axisRotationZ||0);
  model.scale.set(...spec.axisFlip);
  model.updateMatrixWorld(true);
  const correctedBounds=new THREE.Box3().setFromObject(model),correctedSize=correctedBounds.getSize(new THREE.Vector3());
  if(!Number.isFinite(correctedSize.z)||correctedSize.z<=0)throw new Error('飞机模型修正方向后长度无效：'+type);
  // 2) Match the real fuselage length in game units, uniformly on all axes.
  const modelScale=(lengthMeters/METERS_PER_UNIT)/correctedSize.z;
  model.scale.multiplyScalar(modelScale);
  model.updateMatrixWorld(true);
  // 3) Recompute bounds after scaling, then place the scaled center at the aircraft origin.
  const scaledBounds=new THREE.Box3().setFromObject(model),scaledCenter=scaledBounds.getCenter(new THREE.Vector3());
  model.position.sub(scaledCenter);
  model.updateMatrixWorld(true);
  model.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true}});
  attachPropeller(root,model,spec);
  root.add(model);configureCombatLandingGear(root,model);configureMiG3CombatLandingGear(root,model);root.userData.modelAttached=true
 }).catch(error=>{console.error('战机模型初始化失败：'+type,error);root.userData.modelError=true});
 return root
}
// Test the entire projectile step against the aircraft's moving collision box.
// Translation is relative; rotation uses the final frame's orientation.
function sweptAircraftHit(start,end,aircraftRoot,projectileRadius=0){
 const half=aircraftRoot.userData.collisionHalfExtents;if(!half)return false;
 const previous=aircraftRoot.userData.frameStartPosition||aircraftRoot.position;
 const movedStart=start.clone().add(aircraftRoot.position).sub(previous);
 const a=aircraftRoot.worldToLocal(movedStart),b=aircraftRoot.worldToLocal(end.clone());
 const radius=projectileRadius/Math.max(.00001,Math.min(Math.abs(aircraftRoot.scale.x),Math.abs(aircraftRoot.scale.y),Math.abs(aircraftRoot.scale.z)));
 let enter=0,exit=1;
 for(const axis of ['x','y','z']){
  const extent=half[axis]+radius,delta=b[axis]-a[axis];
  if(Math.abs(delta)<1e-9){if(Math.abs(a[axis])>extent)return false;continue}
  let near=(-extent-a[axis])/delta,far=(extent-a[axis])/delta;
  if(near>far)[near,far]=[far,near];enter=Math.max(enter,near);exit=Math.min(exit,far);
  if(enter>exit)return false
 }
 return true
}
function rememberAircraftFrameStart(){
 const roots=gameMode==='airspace'?airspaceLiveUnits().map(unit=>unit.root):[player,...(gameMode==='campaign'?campaignTargets().map(t=>t.root):[enemy])];
 for(const root of roots){if(!root)continue;(root.userData.frameStartPosition??=new THREE.Vector3()).copy(root.position);(root.userData.renderPreviousPosition??=new THREE.Vector3()).copy(root.position);(root.userData.renderPreviousQuaternion??=new THREE.Quaternion()).copy(root.quaternion)}
}

function insideAircraftHitbox(point,aircraftRoot,projectileRadius=0){const half=aircraftRoot.userData.collisionHalfExtents;if(!half)return false;const local=aircraftRoot.worldToLocal(point.clone());return Math.abs(local.x)<=half.x+projectileRadius&&Math.abs(local.y)<=half.y+projectileRadius&&Math.abs(local.z)<=half.z+projectileRadius}
function freshAmmo(type){if(type==='i16')return{mg:850,m2:0,mg762:0,n37:0,ns23:0,hispano:0};if(type==='i15')return{mg:3200,m2:0,mg762:0,n37:0,ns23:0,hispano:0};if(type==='mig3')return{mg:0,m2:280,mg762:1500,n37:0,ns23:0,hispano:0};if(type==='b29'){const loadout=BOMBER_LOADOUTS[selectedBombPayload];return{mg:0,m2:0,mg762:0,n37:0,ns23:0,hispano:0,b29mg:12000,bombs:loadout.count,bombWeightLb:loadout.eachLb}}if(type==='p36a'||type==='f3f2')return{mg:0,m2:200,mg762:500,n37:0,ns23:0,hispano:0};if(type==='mig15')return{mg:0,m2:0,mg762:0,n37:40,ns23:160,hispano:0};if(type==='i15bis')return{mg:3050,n37:0,ns23:0,hispano:0};if(type==='bf109b1')return{mg:1000,n37:0,ns23:0,hispano:0};if(type==='meteor')return{mg:0,n37:0,ns23:0,hispano:720};return{mg:1800,n37:0,ns23:0,hispano:0}}
function selectedWeaponIds(type,mode){return(type==='mig3'||type==='p36a'||type==='f3f2')?['m2','mg762']:type==='mig15'?(mode==='both'?['n37','ns23']:[mode]):type==='meteor'?['hispano']:['mg']}
function updateThrottleUI(){$('#throttlePercent').textContent=Math.round(throttleValue*100)+'%';const info=planeInfo[playerPlane],max=info.maxSpeedKmh,min=info.minLevelFlightKmh;$('#throttleMax').textContent='最大 '+max+' km/h';$('#throttleMin').textContent='平飞 '+min+' km/h';$('#throttleMinMark').style.bottom=(min/max*100)+'%';$('#throttleFill').style.height=(throttleValue*100)+'%';$('#throttleThumb').style.bottom=(throttleValue*100)+'%'}
function updateAmmoUI(){if(playerPlane==='i16'){$('#ammo').textContent=`ShKAS ${playerAmmo.mg} / 850`;$('#ammoBar').style.width=(playerAmmo.mg/850*100)+'%'}else if(playerPlane==='i15'){$('#ammo').textContent=`PV-1 ${playerAmmo.mg} / 3200`;$('#ammoBar').style.width=(playerAmmo.mg/3200*100)+'%'}else if(playerPlane==='mig3'){$('#ammo').textContent=`UBS ${playerAmmo.m2} / 280 · ShKAS ${playerAmmo.mg762} / 1500`;$('#ammoBar').style.width=((playerAmmo.m2+playerAmmo.mg762)/1780*100)+'%'}else if(playerPlane==='b29'){const loadout=BOMBER_LOADOUTS[selectedBombPayload];$('#ammo').textContent=`炮塔 ${playerAmmo.b29mg??12000} · 炸弹 ${playerAmmo.bombs??loadout.count}×${loadout.eachLb}磅`;$('#ammoBar').style.width=((playerAmmo.b29mg??12000)/12000*100)+'%'}else if(playerPlane==='p36a'||playerPlane==='f3f2'){$('#ammo').textContent=`M2 ${playerAmmo.m2} / 200 · 7.62 mm ${playerAmmo.mg762} / 500`;$('#ammoBar').style.width=(((playerAmmo.m2+playerAmmo.mg762)/700)*100)+'%'}else if(playerPlane==='mig15'){$('#ammo').textContent=`N-37 ${playerAmmo.n37} · NS-23 ${playerAmmo.ns23}`;$('#ammoBar').style.width=(((playerAmmo.n37+playerAmmo.ns23)/200)*100)+'%'}else if(playerPlane==='meteor'){$('#ammo').textContent=`Hispano ${playerAmmo.hispano} / 720`;$('#ammoBar').style.width=(playerAmmo.hispano/720*100)+'%'}else{const capacity=playerPlane==='bf109b1'?1000:playerPlane==='i15bis'?3050:1800;$('#ammo').textContent=`${playerAmmo.mg} / ${capacity}`;$('#ammoBar').style.width=(playerAmmo.mg/capacity*100)+'%'}$('#weaponSelect').classList.toggle('hidden',playerPlane!=='mig15');$('#weaponSelect').textContent=weaponMode==='n37'?'N-37 单炮':weaponMode==='ns23'?'NS-23 双炮':'三炮齐射';document.querySelector('[data-key="fire"]').classList.toggle('hidden',playerPlane==='b29');document.querySelector('[data-key="bomb"]').classList.toggle('hidden',playerPlane!=='b29')}
function campaignTargets(){return [...campaignBombers,...campaignEscorts]}
function nearestCampaignTarget(){if(!player)return null;let nearest=null,nearestDistance=Infinity;for(const target of campaignTargets()){const distance=target.root.position.distanceToSquared(player.position);if(distance<nearestDistance){nearest=target;nearestDistance=distance}}return nearest}
function updateCampaignHud(){const active=gameMode==='campaign'&&playing;$('#campaignHud').classList.toggle('hidden',!active);if(!active)return;const seconds=Math.max(0,Math.ceil(campaignTimeRemaining)),minutes=Math.floor(seconds/60),remainder=seconds%60;$('#campaignTimer').textContent=String(minutes).padStart(2,'0')+':'+String(remainder).padStart(2,'0');$('#campaignBomberCount').textContent=campaignBombers.length;$('#campaignEscortCount').textContent=campaignEscorts.length;$('#campaignResupply').textContent=Math.max(0,Math.ceil(campaignResupplyRemaining))}
function spawnCampaignBomber(position,id){const root=aircraft(false,'b29');root.position.copy(position);root.quaternion.identity();const speed=320/3.6;root.userData.airspeed=speed;root.userData.velocity.set(0,0,-speed/METERS_PER_UNIT);root.userData.throttle=320/575;root.userData.engineRunning=true;root.userData.bomberGunsActive=false;root.userData.bomberGunClock=0;scene.add(root);const target={root,health:5000,maxHealth:5000,isBomber:true,id};campaignBombers.push(target);return target}
function spawnCampaignEscort(){
 if(campaignEscorts.length>=CAMPAIGN_ESCORT_LIMIT||campaignBombers.length===0)return null;
 const lead=campaignBombers[0].root,center=lead.position,index=campaignEscortSerial++,angle=index*2.399963229728653,radius=36+(index%3)*6,slot=new THREE.Vector3(Math.cos(angle)*radius,(index%3-1)*2,Math.sin(angle)*radius),position=center.clone().add(slot.clone().applyQuaternion(lead.quaternion));
 const root=aircraft(false,'f86');root.position.copy(position);
 root.quaternion.copy(lead.quaternion);
 const data=root.userData;data.campaignCruiseKmh=400+(index%5)*20;data.airspeed=data.campaignCruiseKmh/3.6;
 data.velocity.set(0,0,-data.airspeed/METERS_PER_UNIT).applyQuaternion(root.quaternion);data.throttle=data.campaignCruiseKmh/planeInfo.f86.maxSpeedKmh;
 data.ammo=freshAmmo('f86');data.weaponCooldowns={mg:0,n37:0,ns23:0,hispano:0};data.weaponMode='mg';data.escortSerial=index;
 const ai=initializeFighterAI(root,'escort',index);ai.formationRoot=lead;ai.formationOffset.copy(slot);scene.add(root);
 const escort={root,health:planeInfo.f86.health,maxHealth:planeInfo.f86.health,isBomber:false,id:index+1};campaignEscorts.push(escort);return escort
}
function startCampaign(){campaignBombers.length=0;campaignEscorts.length=0;campaignRespawns.length=0;campaignElapsed=0;campaignTimeRemaining=CAMPAIGN_DURATION;campaignResupplyRemaining=CAMPAIGN_RESUPPLY_INTERVAL;campaignEscortSerial=0;campaignBomberPhase=0;enemy=null;enemyPlaneType='b29';const lead=player.position.clone().add(new THREE.Vector3(0,-8,-155));spawnCampaignBomber(lead,1);spawnCampaignBomber(lead.clone().add(new THREE.Vector3(-22,0,14)),2);spawnCampaignBomber(lead.clone().add(new THREE.Vector3(23,-1,17)),3);for(let i=0;i<CAMPAIGN_ESCORT_LIMIT;i++)spawnCampaignEscort();updateHealthUI();updateCampaignHud();toast('战役开始：击落3架B-29')}
function updateCampaignEscortAI(dt){
 if(!player||!campaignBombers.length)return;
 const lead=campaignBombers[0].root,center=lead.position;
 for(const escort of [...campaignEscorts]){
  escort.root.userData.ai.formationRoot=lead;updateFighterAI(escort.root,player,center,dt);
  if(escort.health>0&&escort.root.position.y<terrainHeightAt(escort.root.position.x,escort.root.position.z))damageCampaignTarget(escort,escort.health)
 }
}
function updateCampaignBomberFlight(dt){
 // Keep the 3 bombers and their escorts inside the 6 km map for the full 5-minute mission.
 const radius=130,angularSpeed=(320/3.6/METERS_PER_UNIT)/radius;
 campaignBomberPhase-=angularSpeed*dt;
 const phase=campaignBomberPhase,center=new THREE.Vector3(-130,52,-55),forward=new THREE.Vector3(Math.sin(phase),0,-Math.cos(phase)),right=new THREE.Vector3(Math.cos(phase),0,Math.sin(phase)),formation={1:[0,0,0],2:[-22,0,14],3:[23,-1,17]};
 const lead=center.add(new THREE.Vector3(radius*Math.cos(phase),0,radius*Math.sin(phase)));
 for(const target of campaignBombers){
  const [side,up,behind]=formation[target.id],next=lead.clone().addScaledVector(right,side).addScaledVector(forward,-behind);next.y+=up;
  target.root.userData.velocity.copy(next).sub(target.root.position).divideScalar(dt);target.root.position.copy(next);
  target.root.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),forward);target.root.userData.airspeed=target.root.userData.velocity.length()*METERS_PER_UNIT
 }
}
function updateCampaign(dt){campaignElapsed+=dt;campaignTimeRemaining=Math.max(0,CAMPAIGN_DURATION-campaignElapsed);campaignResupplyRemaining-=dt;updateCampaignBomberFlight(dt);if(campaignResupplyRemaining<=0){campaignResupplyRemaining+=CAMPAIGN_RESUPPLY_INTERVAL;playerAmmo=freshAmmo('mig15');playerWeaponCooldowns={mg:0,m2:0,mg762:0,n37:0,ns23:0,hispano:0};updateAmmoUI();toast('战役补给：弹药已补满')}for(let i=campaignRespawns.length-1;i>=0&&campaignEscorts.length<CAMPAIGN_ESCORT_LIMIT;i--){if(campaignRespawns[i]<=campaignElapsed){campaignRespawns.splice(i,1);spawnCampaignEscort();toast('F-86护航机已补入编队')}}if(campaignTimeRemaining<=0){finish(false);return}updateCampaignEscortAI(dt)}
function damageCampaignTarget(target,n){if(!target||target.health<=0)return;target.health=Math.max(0,target.health-n);if(target.health>0){updateHealthUI();return}retireAircraft(target.root);const list=target.isBomber?campaignBombers:campaignEscorts,index=list.indexOf(target);if(index>=0)list.splice(index,1);playSfx('kill',.35);kills++;$('#kills').textContent=String(kills).padStart(2,'0');if(target.isBomber)toast('B-29击落 · 剩余 '+campaignBombers.length+' 架');else{campaignRespawns.push(campaignElapsed+CAMPAIGN_ESCORT_RESPAWN);toast('F-86被击落 · 30秒内补充')}updateCampaignHud();updateHealthUI();if(campaignBombers.length===0)finish(true)}
function updateHealthUI(){
 if(gameMode==='airspace'){updateAirspaceHealthUI();return}
const playerMax=planeInfo[playerPlane].health;$('#playerHealth').style.width=(hp/playerMax*100)+'%';$('#hpText').textContent=Math.round(hp/playerMax*100)+'%';if(gameMode==='campaign'){const target=nearestCampaignTarget(),targetMax=target?.maxHealth||2000,targetHealth=target?.health||0;$('#enemyHealth').style.width=(targetHealth/targetMax*100)+'%';$('#targetName').textContent=target?(target.isBomber?'目标 · B-29 轰炸机':'护航 · F-86F-2'):'目标 · 编队已全歼';$('#enemyMarker .marker-label').textContent=target?(target.isBomber?'B-29':'F-86'):'目标完成';return}const enemyMax=planeInfo[enemyPlaneType].health;$('#enemyHealth').style.width=(eHp/enemyMax*100)+'%';$('#targetName').textContent='敌机 · '+planeInfo[enemyPlaneType].name;$('#enemyMarker .marker-label').textContent=planeInfo[enemyPlaneType].name}
function spawnEnemy(position=null,orientation=null){enemyPlaneType=chooseDuelOpponent(playerPlane);enemy=aircraft(false,enemyPlaneType);enemy.userData.engineRunning=true;scene.add(enemy);enemy.position.copy(position||player.position.clone().add(new THREE.Vector3((Math.random()-.5)*35,Math.random()*12-6,-105)));enemy.quaternion.copy(orientation||player.quaternion);enemy.userData.velocity.set(0,0,-1).applyQuaternion(enemy.quaternion).multiplyScalar(enemy.userData.airspeed/METERS_PER_UNIT);eHp=planeInfo[enemyPlaneType].health;enemyAmmo=freshAmmo(enemyPlaneType);enemyWeaponMode=enemyPlaneType==='mig15'?['n37','ns23','both'][Math.floor(Math.random()*3)]:enemyPlaneType==='meteor'?'hispano':'mg';enemyWeaponCooldowns={mg:0,m2:0,mg762:0,n37:0,ns23:0,hispano:0};if(enemyPlaneType==='b29')enemy.userData.patrolPhase=0;else initializeFighterAI(enemy,'duel',0);updateHealthUI()}
function cycleWeaponMode(){
 if(gameMode==='airspace'&&!airspacePlayerAlive())return;
if(playerPlane!=='mig15')return;weaponMode=weaponMode==='n37'?'ns23':weaponMode==='ns23'?'both':'n37';if(gameMode==='airspace'){const unit=airspaceUnitFor(player);if(unit)unit.weaponMode=weaponMode}updateAmmoUI();toast(weaponMode==='n37'?'武器切换：N-37单炮':weaponMode==='ns23'?'武器切换：NS-23双炮':'武器切换：三炮齐射')}
function fireWeapons(from,isEnemy,dt,enabled){
 const unit=gameMode==='airspace'?from.userData.airspaceUnit:null;
 const type=unit?.type||(isEnemy?(gameMode==='campaign'?(from.userData.type||'f86'):enemyPlaneType):playerPlane),state=unit?.ammo||(isEnemy?(gameMode==='campaign'?from.userData.ammo:enemyAmmo):playerAmmo),cooldowns=unit?.weaponCooldowns||(isEnemy?(gameMode==='campaign'?from.userData.weaponCooldowns:enemyWeaponCooldowns):playerWeaponCooldowns),mode=unit?(unit.isPlayer?weaponMode:unit.weaponMode):(isEnemy?(gameMode==='campaign'?from.userData.weaponMode:enemyWeaponMode):weaponMode);
 if(unit?.dead)return;
 let ammoChanged=false;const active=selectedWeaponIds(type,mode);
 for(const id of ['mg','m2','mg762','n37','ns23','hispano']){
  cooldowns[id]=(cooldowns[id]||0)-dt;
  const selected=active.includes(id),trigger=typeof enabled==='boolean'?enabled:!!enabled?.[id],spec=weaponInfo[type]?.[id];
  if(!selected||!trigger||!spec){cooldowns[id]=Math.max(0,cooldowns[id]);continue}
  let bursts=0;
  while(cooldowns[id]<=0&&state[id]>=spec.cost&&bursts<3){
   const bulletDamage=isEnemy&&gameMode==='campaign'&&type==='f86'?12:spec.damage,q=from.quaternion,resourceId=type+':'+id;
   const resource=ensureBulletResources(type,id);
   for(const offset of spec.offsets){
    const bullet=bulletPool.pop()||{mesh:new THREE.Mesh(resource.geometry,resource.material),dir:new THREE.Vector3()};
    bullet.mesh.geometry=resource.geometry;bullet.mesh.material=resource.material;
    bullet.mesh.position.copy(from.position).add(new THREE.Vector3(offset[0],offset[1],offset[2]).multiplyScalar(from.scale.x).applyQuaternion(q));
    bullet.dir.set(0,0,-1).applyQuaternion(q);bullet.speed=spec.speed/METERS_PER_UNIT;bullet.radius=spec.radius/METERS_PER_UNIT;
    bullet.life=2.1;bullet.enemy=isEnemy;bullet.team=unit?.team||(isEnemy?'red':'blue');bullet.shooterId=unit?.id||null;bullet.damage=bulletDamage;bullet.weapon=id;scene.add(bullet.mesh);bullets.push(bullet)
   }
   state[id]-=spec.cost;ammoChanged=true;cooldowns[id]+=60/spec.rpm;bursts++;
   playGunShot(gunSoundFor(type,id),from,isEnemy,60/spec.rpm)
  }
  if(bursts===3&&cooldowns[id]<=0)cooldowns[id]=0
 }
 if(!isEnemy&&ammoChanged)updateAmmoUI()
}
function releaseBullet(index){const bullet=bullets[index];scene.remove(bullet.mesh);bullets.splice(index,1);if(bulletPool.length<512)bulletPool.push(bullet)}
function fireBomberTurrets(from,isEnemy,dt){
 if(gameMode==='airspace'){fireAirspaceBomberTurrets(airspaceUnitFor(from),dt);return}
const type=isEnemy?enemyPlaneType:playerPlane;if(type!=='b29')return;const target=isEnemy?player:enemy,state=isEnemy?enemyAmmo:playerAmmo,data=from.userData,stopPlayerGun=()=>{};if(!target||!state||state.b29mg<=0){data.bomberGunsActive=false;data.bomberGunClock=0;data.bomberEligibleTurrets=[];data.bomberEligibleGuns=0;stopPlayerGun();return}data.bomberArcCheckRemaining=(data.bomberArcCheckRemaining??0)-dt;if(data.bomberArcTarget!==target||data.bomberArcCheckRemaining<=0){data.bomberArcTarget=target;data.bomberArcCheckRemaining=.075;const targetLocal=target.position.clone().sub(from.position).applyQuaternion(from.quaternion.clone().invert());data.bomberEligibleTurrets=B29_TURRETS.filter(turret=>{const relative=targetLocal.clone().sub(new THREE.Vector3(...turret.offset));return relative.length()*METERS_PER_UNIT<=250&&bomberTurretCanTrack(turret,relative)});data.bomberEligibleGuns=data.bomberEligibleTurrets.reduce((sum,turret)=>sum+turret.guns,0)}const eligibleTurrets=data.bomberEligibleTurrets||[],eligibleGuns=data.bomberEligibleGuns||0;if(!eligibleTurrets.length){data.bomberGunsActive=false;data.bomberGunClock=0;stopPlayerGun();return}if(!data.bomberGunsActive){toast(isEnemy?'遭到B-29炮塔攻击':'B-29炮塔自动开火');data.bomberGunsActive=true}const interval=60/450;data.bomberGunClock+=dt;let ammoSpent=0;while(data.bomberGunClock>=interval&&state.b29mg>0){data.bomberGunClock-=interval;const rounds=Math.min(eligibleGuns,state.b29mg);state.b29mg-=rounds;ammoSpent+=rounds;playGunShot('b29Gun',from,isEnemy,interval,true);let hits=0;for(let i=0;i<rounds;i++)if(Math.random()<.5)hits++;if(hits)damage(isEnemy?'player':'enemy',hits*20)}if(!isEnemy&&ammoSpent>0)updateAmmoUI()}
function dropBomb(){
 if(gameMode==='airspace'&&!airspacePlayerAlive())return;
if(!playing||playerPlane!=='b29'||!playerAmmo||playerAmmo.bombs<=0)return;const loadout=BOMBER_LOADOUTS[selectedBombPayload],mesh=new THREE.Mesh(new THREE.CylinderGeometry(.045,.075,.36,8),new THREE.MeshStandardMaterial({color:0x46505a,roughness:.75,metalness:.35})),release=new THREE.Vector3(0,-.16,0).multiplyScalar(player.scale.x).applyQuaternion(player.quaternion);mesh.position.copy(player.position).add(release);scene.add(mesh);bombsInFlight.push({mesh,velocity:player.userData.velocity.clone(),damage:Math.round(700*loadout.eachLb/1000),radius:.12,life:30});playerAmmo.bombs--;playSfx('bombDrop',.5);updateAmmoUI();toast('炸弹投放 · '+loadout.eachLb+'磅')}
function updateDroppedBombs(dt){
 if(gameMode==='airspace'){updateAirspaceBombs(dt);return}
for(let i=bombsInFlight.length-1;i>=0;i--){const bomb=bombsInFlight[i];bomb.velocity.y-=9.81/METERS_PER_UNIT*dt;bomb.mesh.position.addScaledVector(bomb.velocity,dt);bomb.life-=dt;let hit=false;if(gameMode==='campaign'){for(const target of campaignTargets()){if(insideAircraftHitbox(bomb.mesh.position,target.root,bomb.radius)){damage('enemy',bomb.damage,target);hit=true;break}}}else if(enemy&&insideAircraftHitbox(bomb.mesh.position,enemy,bomb.radius)){damage('enemy',bomb.damage);hit=true}if(hit||bomb.mesh.position.y<=-90||bomb.life<=0){scene.remove(bomb.mesh);bombsInFlight.splice(i,1)}}}
function resizePreview(){if(!previewRenderer)return;const canvas=$('#previewCanvas'),w=Math.max(1,canvas.clientWidth),h=Math.max(1,canvas.clientHeight);previewRenderer.setPixelRatio(Math.min(devicePixelRatio,1.5));previewRenderer.setSize(w,h,false);previewCamera.aspect=w/h;previewCamera.updateProjectionMatrix()}
function ensureCatalogPreview(){if(previewRenderer)return;const canvas=$('#previewCanvas');previewRenderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});previewScene=new THREE.Scene();previewScene.background=new THREE.Color(0x142536);previewCamera=new THREE.PerspectiveCamera(45,1,.1,150);previewScene.add(new THREE.HemisphereLight(0xd8f1ff,0x36424a,2.2));const light=new THREE.DirectionalLight(0xffedcf,2.4);light.position.set(5,9,7);previewScene.add(light)}
function setCatalogSpecs(type){const info=planeInfo[type];if(!info)return;previewType=type;document.querySelectorAll('[data-preview-plane]').forEach(button=>button.classList.toggle('active',button.dataset.previewPlane===type));$('#catalogName').textContent=info.name;$('#catalogIntro').textContent=info.intro;$('#catalogSpecs').innerHTML=info.specs.map(([label,value])=>'<div class="spec-item"><b>'+label+'</b><span>'+value+'</span></div>').join('');ensureCatalogPreview();if(previewPlane)previewScene.remove(previewPlane);previewPlane=aircraft(false,type,{preview:true});previewScene.add(previewPlane);const bounds=AIRCRAFT_SPECS[type].collisionMeters,span=Math.max(bounds.x,bounds.y,bounds.z)/METERS_PER_UNIT,distance=Math.max(2.0,span*.95);previewCamera.position.set(distance*.88,distance*.48,-distance*.9);previewCamera.lookAt(0,0,0);updateEconomyDisplay()}
function openCatalog(){showMenuScreen('encyclopedia');ensureCatalogPreview();resizePreview();setCatalogSpecs(previewType);resizePreview();previewCamera.lookAt(0,0,0);previewRenderer.render(previewScene,previewCamera)}
function closeCatalog(){if(previewRenderer)previewRenderer.render(previewScene,previewCamera);showMenuScreen('menu')}
function buildKoreaHeightGrid(terrain){
 const resolution=128,heights=new Float32Array(resolution*resolution).fill(-Infinity),sample=new THREE.Vector3(),half=MAP_LIBRARY.korea1951.sizeMeters/(2*METERS_PER_UNIT);
 terrain.updateMatrixWorld(true);
 terrain.traverse(node=>{if(!node.isMesh)return;const positions=node.geometry.attributes.position;
  for(let i=0;i<positions.count;i++){
   sample.fromBufferAttribute(positions,i).applyMatrix4(node.matrixWorld);
   const x=Math.round((sample.x+half)/(half*2)*(resolution-1)),z=Math.round((sample.z+half)/(half*2)*(resolution-1));
   if(x>=0&&x<resolution&&z>=0&&z<resolution){const index=z*resolution+x;heights[index]=Math.max(heights[index],sample.y)}
  }
 });
 return{heights,resolution,half}
}
function terrainHeightAt(x,z){
 if(activeMapId!=='korea1951'||!koreaHeightGrid)return-90;
 const{heights,resolution,half}=koreaHeightGrid;
 if(Math.abs(x)>half||Math.abs(z)>half)return-90;
 const u=(x+half)/(half*2)*(resolution-1),v=(z+half)/(half*2)*(resolution-1),i=Math.min(resolution-2,Math.floor(u)),j=Math.min(resolution-2,Math.floor(v)),fx=u-i,fz=v-j;
 const h00=heights[j*resolution+i],h10=heights[j*resolution+i+1],h01=heights[(j+1)*resolution+i],h11=heights[(j+1)*resolution+i+1];
 if(![h00,h10,h01,h11].every(Number.isFinite))return-90;
 return h00*(1-fx)*(1-fz)+h10*fx*(1-fz)+h01*(1-fx)*fz+h11*fx*fz
}
function loadKoreaTerrain(){
 if(!koreaTerrainPromise)koreaTerrainPromise=planeModelLoader.loadAsync(MAP_LIBRARY.korea1951.modelFile).then(gltf=>{
  const terrain=gltf.scene,bounds=new THREE.Box3().setFromObject(terrain),size=bounds.getSize(new THREE.Vector3()),width=MAP_LIBRARY.korea1951.sizeMeters/METERS_PER_UNIT;
  if(size.x<=0||size.z<=0)throw new Error('地形长宽无效');
  terrain.scale.multiplyScalar(width/Math.max(size.x,size.z));terrain.updateMatrixWorld(true);
  const scaledBounds=new THREE.Box3().setFromObject(terrain),center=scaledBounds.getCenter(new THREE.Vector3());
  terrain.position.x-=center.x;terrain.position.z-=center.z;terrain.position.y+=-90-scaledBounds.min.y;
  terrain.updateMatrixWorld(true);
  terrain.traverse(node=>{if(node.isMesh){node.receiveShadow=true;node.frustumCulled=true}});
  const coverage=new THREE.Box3().setFromObject(terrain);
  koreaTerrainBounds={minX:coverage.min.x,maxX:coverage.max.x,minZ:coverage.min.z,maxZ:coverage.max.z};
  koreaTerrain=terrain;
  return terrain
 }).catch(error=>{koreaTerrainPromise=null;console.error('无法加载1951·朝鲜地图',error);return null});
 return koreaTerrainPromise
}
function setBattleMap(id){
 activeMapId=id;const korea=id==='korea1951';
 scene.background.setHex(korea?0x9cb9ca:0x83b9d1);
 scene.fog.color.setHex(korea?0xa9bdc4:0x9bbfce);scene.fog.near=korea?230:170;scene.fog.far=korea?1050:620;
 mapHemisphere.color.setHex(korea?0xd5e9ef:0xdaf5ff);mapHemisphere.groundColor.setHex(korea?0x62665c:0x596c74);mapHemisphere.intensity=korea?1.95:2.3;
 mapSun.color.setHex(korea?0xffe1ad:0xffedcf);mapSun.intensity=korea?2.35:2.5;mapSun.position.set(korea?-160:90,korea?220:150,korea?-85:-70);
 groundPlane.material.color.setHex(korea?0x5a6858:0x286379);groundPlane.material.roughness=korea?1:.86;groundPlane.material.metalness=korea?0:.12;
 for(const cloud of clouds){
  cloud.position.set((Math.random()-.5)*(korea?610:860),korea?140+Math.random()*115:50+Math.random()*125,(Math.random()-.5)*(korea?610:900));
  cloud.userData.range=korea?340:430;cloud.userData.drift=(korea?1.5:3)+Math.random()*(korea?3:8);
  cloud.traverse(node=>{if(node.isMesh)node.material.color.setHex(korea?0xf5eee3:0xf1f5f0)})
 }
 if(!korea){if(koreaTerrain)koreaTerrain.visible=false;return}
 loadKoreaTerrain().then(terrain=>{
  if(!terrain||activeMapId!=='korea1951'||!scene)return;
  if(terrain.parent!==scene)scene.add(terrain);
  terrain.visible=true;
  if(!koreaHeightGrid)koreaHeightGrid=buildKoreaHeightGrid(terrain)
 })
}
function init(){
 scene=new THREE.Scene();scene.background=new THREE.Color(0x83b9d1);scene.fog=new THREE.Fog(0x9bbfce,170,620);
 camera=new THREE.PerspectiveCamera(63,innerWidth/innerHeight,.02,1400);
 renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;sceneRoot.replaceChildren(renderer.domElement);
 mapHemisphere=new THREE.HemisphereLight(0xdaf5ff,0x596c74,2.3);scene.add(mapHemisphere);
 mapSun=new THREE.DirectionalLight(0xffedcf,2.5);mapSun.position.set(90,150,-70);scene.add(mapSun);
 bindFlightControls();groundPlane=new THREE.Mesh(new THREE.PlaneGeometry(2200,2200,1,1),mat(0x286379,.86,.12));groundPlane.rotation.x=-Math.PI/2;groundPlane.position.y=-90.15;scene.add(groundPlane);
 for(let i=0;i<36;i++){
  const cloud=new THREE.Group(),material=new THREE.MeshLambertMaterial({color:0xf1f5f0,transparent:true,opacity:.81,depthWrite:false});
  for(let j=0;j<5;j++){const puff=new THREE.Mesh(new THREE.SphereGeometry(1,8,6),material);puff.position.set((Math.random()-.5)*22,(Math.random()-.5)*2,(Math.random()-.5)*17);puff.scale.set(6+Math.random()*6,1.3+Math.random()*1.8,4+Math.random()*4);cloud.add(puff)}
  cloud.position.set((Math.random()-.5)*860,50+Math.random()*125,(Math.random()-.5)*900);cloud.userData.range=430;cloud.userData.drift=3+Math.random()*8;scene.add(cloud);clouds.push(cloud)
 }
 player=aircraft(true,playerPlane);scene.add(player);player.position.copy(blueSpawn);spawnEnemy(redSpawn.clone(),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));clock=new THREE.Clock();resize();animate()
}
function resize(){if(!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);resizePreview()}addEventListener('resize',resize);
function clearCampaignEntities(){for(const target of campaignTargets())scene.remove(target.root);for(const node of campaignMarkerNodes.values())node.remove();campaignMarkerNodes.clear();campaignBombers.length=0;campaignEscorts.length=0;campaignRespawns.length=0}
function reset(options={}){beginSortieEconomy();battleSimulationAccumulator=0;battleHudElapsed=Infinity;throttleValue=1;resetDuelBoundary();battlePaused=false;clearFlightInputs();$('#again').textContent='再次升空　→';stopGunSounds();playerPlane=gameMode==='campaign'?'mig15':selectedAircraft;resetCameraTracking();if(!scene)init();if(player)scene.remove(player);if(enemy){scene.remove(enemy);enemy=null}clearCampaignEntities();clearAirspaceEntities();for(const wreck of wreckedAircraft)scene.remove(wreck.root);wreckedAircraft.length=0;setBattleMap(gameMode==='campaign'||gameMode==='airspace'?'korea1951':(Math.random()<.5?'openSea':'korea1951'));groundPlane.scale.setScalar(gameMode==='airspace'?600/2200:1);bombsInFlight.forEach(bomb=>scene.remove(bomb.mesh));bombsInFlight.length=0;keys.bomb=false;bombKeyWasDown=false;player=aircraft(true,playerPlane);scene.add(player);for(let i=bullets.length-1;i>=0;i--)releaseBullet(i);player.position.copy(blueSpawn);player.quaternion.identity();resetCursorControl();const initialSpeed=Math.max(player.userData.minFlightSpeedMps*1.12,player.userData.maxSpeedMps*.68);player.userData.airspeed=initialSpeed;player.userData.velocity.set(0,0,-1).multiplyScalar(initialSpeed/METERS_PER_UNIT);player.userData.throttle=throttleValue;player.userData.engineRunning=true;weaponMode=playerPlane==='mig15'?'both':playerPlane==='meteor'?'hispano':'mg';playerAmmo=freshAmmo(playerPlane);playerWeaponCooldowns={mg:0,m2:0,mg762:0,n37:0,ns23:0,hispano:0};hp=planeInfo[playerPlane].health;kills=0;ended=false;playing=!options.preparing;if(playing)startEngineSound(playerPlane);campaignTimeRemaining=CAMPAIGN_DURATION;campaignResupplyRemaining=CAMPAIGN_RESUPPLY_INTERVAL;$('#kills').textContent='00';if(gameMode==='airspace')startAirspaceBattle();else if(gameMode==='campaign')startCampaign();else{campaignElapsed=0;spawnEnemy(redSpawn.clone(),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI))}updateAmmoUI();updateThrottleUI();updateHealthUI();updateEngineUI();['menu','settings','modeSelect','campaignBriefing','hangar','research','encyclopedia','end'].forEach(id=>$('#'+id).classList.add('hidden'));$('#hud').classList.remove('hidden');updateCampaignHud();toast(gameMode==='airspace'?'空域争夺 · 5 V 5 · 抢占 A 点':gameMode==='campaign'?'米格之舞：1951·朝鲜':'进入战区 · '+MAP_LIBRARY[activeMapId].name);clock.getDelta()}
function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),1300)}
function triggerDamageFlash(){const now=performance.now();if(damageFlashTimer!==null||now<damageFlashNextAt)return;damageFlashNextAt=now+200;const hud=$('#hud');hud.classList.add('damage');damageFlashTimer=setTimeout(()=>{hud.classList.remove('damage');damageFlashTimer=null},180)}
function damage(target,n,campaignTarget=null){
 if(gameMode==='airspace'){damageAirspaceUnit(target==='player'?airspaceUnitFor(player):campaignTarget||airspaceUnitFor(enemy),n);return}
if(target==='enemy'&&gameMode==='campaign'&&campaignTarget){damageCampaignTarget(campaignTarget,n);return}if(target==='enemy'){eHp=Math.max(0,eHp-n);$('#enemyHealth').style.width=(eHp/planeInfo[enemyPlaneType].health*100)+'%';if(eHp===0){playSfx('kill',.35);kills++;$('#kills').textContent=String(kills).padStart(2,'0');toast('敌机击落');const spawn=redSpawn.clone().add(new THREE.Vector3((Math.random()-.5)*24,0,(Math.random()-.5)*24)),rot=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);retireAircraft(enemy);spawnEnemy(spawn,rot);if(kills>=3)finish(true)}}else{hp=Math.max(0,hp-n);$('#playerHealth').style.width=(hp/planeInfo[playerPlane].health*100)+'%';$('#hpText').textContent=Math.round(hp/planeInfo[playerPlane].health*100)+'%';triggerDamageFlash();if(hp===0)finish(false)}}
function finish(win){
 if(ended)return;
 if(gameMode==='airspace'){finishAirspaceBattle(win===null?null:win?'blue':'red');return}
resetDuelBoundary();battlePaused=false;clearFlightInputs();playing=false;ended=true;if(player){player.userData.engineRunning=false;if(hp<=0)player.userData.destroyed=true}if(enemy)enemy.userData.engineRunning=false;for(const target of campaignTargets())target.root.userData.engineRunning=false;stopGunSounds();stopEngineSound();updateCampaignHud();if(gameMode==='campaign'){$('#resultTitle').textContent=win?'战役胜利':'任务失败';$('#resultCopy').textContent=win?'米格之舞完成：3架 B-29 均已击落。':hp<=0?'MIG-15 已被击落，南市空战失败。':'300秒时限已到，仍有 B-29 未被击落。'}else{$('#resultTitle').textContent=win?'王牌飞行员':'任务失败';$('#resultCopy').textContent=win?`空战战果：${kills} 架。你已夺取局部制空权。`:`你击落了 ${kills} 架敌机。整备机体，再次出击。`}$('#end').classList.remove('hidden');settleSortieEconomy(win)}
function projectEnemyMarkerPoint(position){const clip=position.clone().project(camera);let nx=clip.x,ny=-clip.y;const behind=clip.z>1;if(behind){nx=-nx;ny=-ny}const visible=!behind&&clip.z>=-1&&Math.abs(nx)<.9&&Math.abs(ny)<.9;if(!visible){if(Math.abs(nx)+Math.abs(ny)<.001)ny=1;const maxX=Math.max(.15,1-36/innerWidth),maxY=Math.max(.15,1-48/innerHeight),scale=Math.min(maxX/Math.max(Math.abs(nx),.001),maxY/Math.max(Math.abs(ny),.001));nx*=scale;ny*=scale}return{x:(nx+1)*innerWidth*.5,y:(ny+1)*innerHeight*.5,visible}}
function updateCampaignEnemyMarkers(){const layer=$('#campaignEnemyMarkers'),single=$('#enemyMarker'),targets=campaignTargets(),active=new Set(targets);layer.classList.remove('hidden');single.classList.add('hidden');for(const[target,node]of campaignMarkerNodes){if(!active.has(target)){node.remove();campaignMarkerNodes.delete(target)}}const occupied=[],offsets=[[0,0],[0,-34],[44,0],[-44,0],[0,34],[34,-30],[-34,-30],[34,30],[-34,30]];for(let radius=68;radius<=420;radius+=46)for(let i=0;i<8;i++){const angle=i*Math.PI/4;offsets.push([Math.cos(angle)*radius,Math.sin(angle)*radius])}const isClear=(x,y)=>occupied.every(p=>Math.abs(x-p.x)>48||Math.abs(y-p.y)>34),clamp=(v,min,max)=>Math.max(min,Math.min(max,v));for(const target of targets){let node=campaignMarkerNodes.get(target);if(!node){node=document.createElement('div');node.className='enemy-marker campaign-target-marker';node.innerHTML='<i class="marker-leader"></i><span class="marker-label"></span>';layer.appendChild(node);campaignMarkerNodes.set(target,node)}const label=node.querySelector('.marker-label'),name=(target.isBomber?'B-29 #':'F-86 #')+target.id;if(label.textContent!==name)label.textContent=name;const anchor=projectEnemyMarkerPoint(target.root.position);node.classList.toggle('offscreen',!anchor.visible);let x=anchor.x,y=anchor.y;const minX=24,maxX=innerWidth-24,minY=24,maxY=innerHeight-32;for(const[dx,dy]of offsets){const candidateX=clamp(anchor.x+dx,minX,maxX),candidateY=clamp(anchor.y+dy,minY,maxY);if(isClear(candidateX,candidateY)){x=candidateX;y=candidateY;break}}occupied.push({x,y});node.style.left=(x/innerWidth*100)+'%';node.style.top=(y/innerHeight*100)+'%';const dx=anchor.x-x,dy=anchor.y-y,distance=Math.hypot(dx,dy);node.style.setProperty('--leader-length',distance>20?distance+'px':'0px');node.style.setProperty('--leader-angle',Math.atan2(dy,dx)+'rad')}}
function updateTacticalDisplay(){
 if(gameMode==='airspace'){updateAirspaceTacticalDisplay();return}
if(!player||!camera)return;const tracked=gameMode==='campaign'?nearestCampaignTarget()?.root:enemy;if(!tracked)return;camera.updateMatrixWorld(true);if(gameMode==='campaign')updateCampaignEnemyMarkers();else{const layer=$('#campaignEnemyMarkers'),marker=$('#enemyMarker');layer.classList.add('hidden');marker.classList.remove('hidden');const point=projectEnemyMarkerPoint(tracked.position);marker.classList.toggle('offscreen',!point.visible);marker.style.left=(point.x/innerWidth*100)+'%';marker.style.top=(point.y/innerHeight*100)+'%'}const canvas=$('#radar'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,cx=w/2,cy=h/2,r=w*.39;ctx.clearRect(0,0,w,h);ctx.fillStyle='rgba(5,20,31,.72)';ctx.beginPath();ctx.arc(cx,cy,r+7,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(105,219,231,.43)';ctx.lineWidth=1;for(const f of [.36,.68,1]){ctx.beginPath();ctx.arc(cx,cy,r*f,0,Math.PI*2);ctx.stroke()}ctx.beginPath();ctx.moveTo(cx-r,cy);ctx.lineTo(cx+r,cy);ctx.moveTo(cx,cy-r);ctx.lineTo(cx,cy+r);ctx.stroke();const right=new THREE.Vector3(1,0,0).applyQuaternion(player.quaternion),forward=new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion),range=260;const plotBase=(point,color,label)=>{const rel=point.clone().sub(player.position);let bx=rel.dot(right)/range*r,by=-rel.dot(forward)/range*r,bd=Math.hypot(bx,by);if(bd>r-5){bx*=((r-5)/bd);by*=((r-5)/bd)}ctx.fillStyle=color;ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(cx+bx,cy+by,5,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.font='bold 7px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,cx+bx,cy+by)};plotBase(blueSpawn,'#39aaff','A');if(gameMode==='campaign'){for(const target of campaignBombers)plotBase(target.root.position,'#ff6268','B');for(const target of campaignEscorts)plotBase(target.root.position,'#ffb14d','F')}else plotBase(redSpawn,'#ff5258','B');const delta=tracked.position.clone().sub(player.position);let ex=delta.dot(right)/range*r,ey=-delta.dot(forward)/range*r,d=Math.hypot(ex,ey);if(d>r-4){ex*=((r-4)/d);ey*=((r-4)/d)}ctx.fillStyle='#ff6e68';ctx.shadowColor='#ff544b';ctx.shadowBlur=8;ctx.beginPath();ctx.arc(cx+ex,cy+ey,4,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;$('#radarDistance').textContent=Math.round(delta.length()*METERS_PER_UNIT)+' m'}
function rotateAircraftLocal(object,axis,angle){if(!angle)return;object.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis,angle)).normalize()}
function rotateAircraftWorld(object,axis,angle){if(!angle)return;object.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis,angle)).normalize()}
function softLimitRate(value,limit){if(limit<=0)return 0;return limit*Math.tanh(value/limit)}
function resetCameraTracking(){cameraTrackedRoot=null;cameraOrbitYaw=0;cameraOrbitPitch=0;cameraInputAt=-1;cameraDragPointer=null;cameraPoseInitialized=false;filteredControlX=0;filteredControlY=0}
function shapeStickVector(x,y){const magnitude=Math.hypot(x,y);if(magnitude<=FLIGHT_CONTROL.deadzone)return{x:0,y:0};const shapedMagnitude=Math.min(1,(Math.min(magnitude,1)-FLIGHT_CONTROL.deadzone)/(1-FLIGHT_CONTROL.deadzone)),scale=shapedMagnitude/magnitude;return{x:x*scale,y:y*scale}}
function flightControlAuthority(data){const airflow=THREE.MathUtils.clamp((data.airspeed||0)/data.minFlightSpeedMps,.35,1);return airflow*(1-.45*THREE.MathUtils.smoothstep(Math.abs(data.aoa||0),.25,.6))}
function shapeControl(value){const magnitude=Math.abs(value);return Math.sign(value)*(.30*magnitude+.70*Math.pow(magnitude,1.5))}
function readFlightControls(dt){
 const response=AIRCRAFT_SPECS[playerPlane].control;
 const raw=shapeStickVector(joystickInput.x+(keys.right?1:0)-(keys.left?1:0),-joystickInput.y+(keys.down?1:0)-(keys.up?1:0));
 const pushBlend=1-Math.exp(-dt/response.stickAttackSeconds),releaseBlend=1-Math.exp(-dt/response.stickReleaseSeconds);
 filteredControlX+=(raw.x-filteredControlX)*(raw.x?pushBlend:releaseBlend);
 filteredControlY+=(raw.y-filteredControlY)*(raw.y?pushBlend:releaseBlend);
 return{roll:shapeControl(filteredControlX),pitch:-shapeControl(filteredControlY)}
}
function updatePlayerFlightControls(dt){
 player.userData.throttle=throttleValue;
 if(controlSettings.mode==='cursor')return updateCursorFlightControls(dt);
 player.userData.flightAssist=false;player.userData.instructorRecovering=false;player.userData.instructorEnergyGuard=false;
 const count=Math.max(1,Math.ceil(dt/FLIGHT_PHYSICS.stepSeconds)),step=dt/count;
 for(let i=0;i<count;i++){
  const data=player.userData,controls=readFlightControls(step),spec=AIRCRAFT_SPECS[playerPlane],response=spec.control,rollLimit=THREE.MathUtils.degToRad(spec.rollRateDps);
  data.controlRoll=controls.roll;data.controlPitch=controls.pitch;data.controlAuthority=flightControlAuthority(data);
  data.bankRate=THREE.MathUtils.clamp(THREE.MathUtils.damp(data.bankRate||0,controls.roll*rollLimit*data.controlAuthority,Math.abs(controls.roll)>.001?response.rollResponse:response.rollRelease,step),-rollLimit,rollLimit);
  rotateAircraftLocal(player,new THREE.Vector3(0,0,-1),data.bankRate*step);
  data.verticalTurnRate=THREE.MathUtils.damp(data.verticalTurnRate||0,limitedPitchRate(data,controls.pitch*verticalTurnRateForPlane(playerPlane)*data.controlAuthority),response.pitchResponse,step);
  rotateAircraftLocal(player,new THREE.Vector3(1,0,0),limitedPitchRate(data,data.verticalTurnRate)*step);advanceAircraft(player,step)
 }
 return player.userData.airspeed
}
const CHASE_REFERENCE_ASPECT=2048/920;
const CHASE_NARROW_PRESETS={"i15":[15.752,4.971],"mig3":[17.275,5.495],"f3f2":[15.734,4.595],"i15bis":[16.541,5.108],"bf109b1":[15.72,4.954],"p36a":[17.002,5.423],"mig15":[18.955,4.828],"f86":[21.645,5.568],"meteor":[22.391,5.882],"b29":[73.016,20.673],"i16":[14.86,4.529]};
function chaseFrameOffsets(type,aspect=camera.aspect){
 const spec=AIRCRAFT_SPECS[type],baseBack=spec.lengthMeters*.5+spec.chaseOffsetMeters,baseHeight=spec.chaseHeightMeters,narrow=CHASE_NARROW_PRESETS[type];
 const t=(CHASE_REFERENCE_ASPECT/Math.max(aspect,1)-1)/(CHASE_REFERENCE_ASPECT/(16/9)-1);
 return{backMeters:baseBack+(narrow[0]-baseBack)*t,heightMeters:baseHeight+(narrow[1]-baseHeight)*t}
}
function updateChaseCamera(dt){
 if(!player||!camera)return;followCameraAnchor(player);
 if(!keys.look&&worldTime-cameraInputAt>=2){
  cameraOrbitYaw=THREE.MathUtils.damp(cameraOrbitYaw,0,2.8,dt);
  cameraOrbitPitch=THREE.MathUtils.damp(cameraOrbitPitch,0,2.8,dt);
  if(Math.abs(cameraOrbitYaw)<.002)cameraOrbitYaw=0;
  if(Math.abs(cameraOrbitPitch)<.002)cameraOrbitPitch=0
 }
 const orbit=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),cameraOrbitYaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),cameraOrbitPitch));
 const baseViewPose=controlSettings.mode==='cursor'?cursorChaseQuaternion():player.quaternion.clone();
 const trackedPose=baseViewPose.clone().multiply(orbit),offset=chaseFrameOffsets(playerPlane),tailDistance=offset.backMeters/METERS_PER_UNIT,chaseHeight=offset.heightMeters/METERS_PER_UNIT;
 const desiredPosition=player.position.clone().add(new THREE.Vector3(0,chaseHeight,tailDistance).applyQuaternion(trackedPose));
 const viewForward=new THREE.Vector3(0,0,-1).applyQuaternion(trackedPose).normalize();
 const lookTarget=player.position.clone().addScaledVector(viewForward,100),inverseAircraftPose=baseViewPose.clone().invert();
 const localBack=desiredPosition.clone().sub(lookTarget).applyQuaternion(inverseAircraftPose).normalize(),localUp=new THREE.Vector3(0,1,0).applyQuaternion(orbit).normalize();
 const localRight=new THREE.Vector3().crossVectors(localUp,localBack);
 if(localRight.lengthSq()<1e-7){
  localRight.set(1,0,0).applyQuaternion(orbit).addScaledVector(localBack,-localRight.dot(localBack));
  if(localRight.lengthSq()<1e-7)localRight.set(0,0,1).applyQuaternion(orbit).addScaledVector(localBack,-localRight.dot(localBack))
 }
 localRight.normalize();
 const localCameraUp=new THREE.Vector3().crossVectors(localBack,localRight).normalize();
 const localPose=new THREE.Matrix4().makeBasis(localRight,localCameraUp,localBack);
 const desiredQuaternion=baseViewPose.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(localPose)).normalize(),positionBlend=1-Math.exp(-FLIGHT_CONTROL.cameraPositionResponse*dt),rotationBlend=1-Math.exp(-FLIGHT_CONTROL.cameraRotationResponse*dt);
 if(!cameraPoseInitialized){camera.position.copy(desiredPosition);camera.quaternion.copy(desiredQuaternion);cameraPoseInitialized=true}
 else{camera.position.lerp(desiredPosition,positionBlend);camera.quaternion.slerp(desiredQuaternion,rotationBlend)}
 camera.updateMatrixWorld(true);
 updateAimingReticle()
}
function updateAimingReticle(){updateFlightAimingHUD()}
function bindFlightControls(){
 const joystick=$('#joystick'),knob=$('#joystickKnob');let joystickPointer=null;
 const moveJoystick=e=>{const r=joystick.getBoundingClientRect(),radius=Math.max(1,r.width*.36),rawX=e.clientX-(r.left+r.width/2),rawY=e.clientY-(r.top+r.height/2),length=Math.hypot(rawX,rawY),scale=length>radius?radius/length:1,x=rawX*scale,y=rawY*scale;joystickInput.x=x/radius;joystickInput.y=y/radius;knob.style.transform=`translate(-50%,-50%) translate(${x}px,${y}px)`};
 const releaseJoystick=(e={})=>{if(joystickPointer!==null&&e.pointerId!==undefined&&e.pointerId!==joystickPointer)return;joystickPointer=null;joystickInput.x=0;joystickInput.y=0;knob.style.transform='translate(-50%,-50%)'};
 joystick.addEventListener('pointerdown',e=>{if(!playing||gameMode==='airspace'&&airspaceSpectating||controlSettings.mode!=='joystick'||(joystickPointer!==null&&joystickPointer!==e.pointerId))return;e.preventDefault();joystickPointer=e.pointerId;try{joystick.setPointerCapture(e.pointerId)}catch{}moveJoystick(e)});
 joystick.addEventListener('pointermove',e=>{if(e.pointerId===joystickPointer)moveJoystick(e)});
 ['pointerup','pointercancel','lostpointercapture'].forEach(type=>joystick.addEventListener(type,releaseJoystick));
 const canvas=renderer.domElement;
 canvas.addEventListener('pointerdown',e=>{
  if(!playing||e.button!==0)return;e.preventDefault();
  if(controlSettings.mode==='cursor'&&!keys.look&&!(gameMode==='airspace'&&airspaceSpectating)){
   if(cursorDragPointer)return;
   cursorDragPointer={id:e.pointerId,x:e.clientX,y:e.clientY}
  }else{
   if(cameraDragPointer)return;
   cameraDragPointer={id:e.pointerId,x:e.clientX,y:e.clientY};cameraInputAt=worldTime
  }
  try{canvas.setPointerCapture(e.pointerId)}catch{}
 });
 canvas.addEventListener('pointermove',e=>{
  if(cursorDragPointer&&e.pointerId===cursorDragPointer.id){
   const dx=e.clientX-cursorDragPointer.x,dy=e.clientY-cursorDragPointer.y;
   cursorDragPointer.x=e.clientX;cursorDragPointer.y=e.clientY;moveCursorDirection(dx,dy);return
  }
  if(!cameraDragPointer||e.pointerId!==cameraDragPointer.id)return;
  const dx=e.clientX-cameraDragPointer.x,dy=e.clientY-cameraDragPointer.y;cameraDragPointer.x=e.clientX;cameraDragPointer.y=e.clientY;
  cameraOrbitYaw=THREE.MathUtils.euclideanModulo(cameraOrbitYaw-dx*.008+Math.PI,Math.PI*2)-Math.PI;
  cameraOrbitPitch=THREE.MathUtils.clamp(cameraOrbitPitch+dy*.008,-1.25,1.25);cameraInputAt=worldTime
 });
 const releaseCanvas=(e={})=>{
  if(cursorDragPointer&&(e.pointerId===undefined||e.pointerId===cursorDragPointer.id))cursorDragPointer=null;
  if(cameraDragPointer&&(e.pointerId===undefined||e.pointerId===cameraDragPointer.id)){cameraDragPointer=null;cameraInputAt=worldTime}
 };
 ['pointerup','pointercancel','lostpointercapture'].forEach(type=>canvas.addEventListener(type,releaseCanvas));
 const track=$('#throttleTrack');let throttlePointer=null;
 const setThrottle=e=>{const r=track.getBoundingClientRect();throttleValue=THREE.MathUtils.clamp(1-(e.clientY-r.top)/Math.max(r.height,1),0,1);if(player)player.userData.throttle=throttleValue;updateThrottleUI()};
 track.addEventListener('pointerdown',e=>{if(!playing||gameMode==='airspace'&&airspaceSpectating||(throttlePointer!==null&&throttlePointer!==e.pointerId))return;e.preventDefault();throttlePointer=e.pointerId;try{track.setPointerCapture(e.pointerId)}catch{}setThrottle(e)});
 track.addEventListener('pointermove',e=>{if(e.pointerId===throttlePointer)setThrottle(e)});
 const releaseThrottle=(e={})=>{if(throttlePointer!==null&&e.pointerId!==undefined&&e.pointerId!==throttlePointer)return;throttlePointer=null};
 ['pointerup','pointercancel','lostpointercapture'].forEach(type=>track.addEventListener(type,releaseThrottle));
 flightPointerClearers.push(()=>{
  const pointers=[[joystick,joystickPointer],[canvas,cursorDragPointer?.id],[canvas,cameraDragPointer?.id],[track,throttlePointer]];
  pointers.forEach(([node,id])=>{if(id!==null&&id!==undefined)try{if(node.hasPointerCapture(id))node.releasePointerCapture(id)}catch{}});
  releaseJoystick();releaseCanvas();releaseThrottle()
 })
}
function turnRateForPlane(type,airspeedMps){const info=planeInfo[type];if(!info)return 0;const timedRate=Number.isFinite(info.horizontalTurnRateDps)?THREE.MathUtils.degToRad(info.horizontalTurnRateDps):2*Math.PI/Math.max(info.turnTimeS||24,1),radiusRate=Math.max(0,airspeedMps)/Math.max(info.turnRadiusM||300,1);return Math.min(timedRate,radiusRate)}
function verticalTurnRateForPlane(type){const info=planeInfo[type];return info&&Number.isFinite(info.verticalTurnRateDps)?THREE.MathUtils.degToRad(info.verticalTurnRateDps):0}
function steerAircraftToward(aircraft,targetDirection,dt){
 const data=aircraft.userData,type=data.type,speed=Math.max(data.airspeed||0,1),authority=flightControlAuthority(data),target=limitAICeilingDirection(aircraft,instructorDirection(aircraft,targetDirection,dt)),forward=new THREE.Vector3(0,0,-1).applyQuaternion(aircraft.quaternion),travel=data.velocity.clone().normalize(),targetFlat=target.clone().setY(0),travelFlat=travel.clone().setY(0),turnLimit=turnRateForPlane(type,speed);
 let targetBank=0;
 if(targetFlat.lengthSq()>.001&&travelFlat.lengthSq()>.001&&!data.instructorRecovering){
  targetFlat.normalize();travelFlat.normalize();
  const yawError=Math.atan2(new THREE.Vector3().crossVectors(travelFlat,targetFlat).y,THREE.MathUtils.clamp(travelFlat.dot(targetFlat),-1,1));
  const desiredRate=THREE.MathUtils.clamp(yawError*1.4,-turnLimit,turnLimit),pathHorizontal=Math.sqrt(Math.max(0,1-travel.y*travel.y)),verticalError=Math.asin(THREE.MathUtils.clamp(target.y,-1,1))-Math.asin(THREE.MathUtils.clamp(travel.y,-1,1));
  const requiredUp=9.81*pathHorizontal+speed*THREE.MathUtils.clamp(verticalError*1.4,-verticalTurnRateForPlane(type)*FLIGHT_PHYSICS.negativePitchFraction,verticalTurnRateForPlane(type));
  if(requiredUp< -4)data.instructorLiftSign=-1;else if(requiredUp>4)data.instructorLiftSign=1;
  const liftSign=data.instructorLiftSign||1;
  targetBank=THREE.MathUtils.clamp(Math.atan2(-speed*desiredRate*pathHorizontal*liftSign,Math.max(3,Math.abs(requiredUp))),-FLIGHT_PHYSICS.maxBankRadians,FLIGHT_PHYSICS.maxBankRadians)
 }
 const up=new THREE.Vector3(0,1,0).applyQuaternion(aircraft.quaternion),horizonUp=new THREE.Vector3(0,1,0).addScaledVector(forward,-forward.y);
 // Bank is undefined exactly above/below the horizon: keep the current roll reference.
 if(horizonUp.lengthSq()<.0001)horizonUp.copy(up);horizonUp.normalize();
 const levelRight=new THREE.Vector3().crossVectors(forward,horizonUp).normalize(),bank=Math.atan2(up.dot(levelRight),up.dot(horizonUp)),bankError=Math.atan2(Math.sin(targetBank-bank),Math.cos(targetBank-bank)),rollLimit=THREE.MathUtils.degToRad(AIRCRAFT_SPECS[type].rollRateDps)*authority;
 data.aiRollRate=THREE.MathUtils.damp(data.aiRollRate||0,THREE.MathUtils.clamp(bankError*4.2,-rollLimit,rollLimit),AI_CONTROL.rollResponse,dt);
 rotateAircraftLocal(aircraft,new THREE.Vector3(0,0,-1),data.aiRollRate*dt);
 const local=target.clone().applyQuaternion(aircraft.quaternion.clone().invert());
 let pitchError=Math.atan2(local.y,-local.z);
 // An exactly rearward, level target needs a banked turn, not an arbitrary vertical loop.
 if(local.z>0&&Math.abs(local.y)<.01)pitchError=0;
 const pitchTarget=limitedPitchRate(data,softLimitRate(pitchError*3.2,verticalTurnRateForPlane(type)*authority));
 data.aiPitchRate=THREE.MathUtils.damp(data.aiPitchRate||0,pitchTarget,AI_CONTROL.pitchResponse,dt);
 rotateAircraftLocal(aircraft,new THREE.Vector3(1,0,0),limitedPitchRate(data,data.aiPitchRate)*dt)
}
// PCM slices: one attack per weapon packet; stationary, crossfaded engine loops.
const AUDIO_FILES={jetEngine:'./audio/jet_engine_loop.wav',b29Engine:'./audio/b29_engine_loop.wav',i15Engine:'./audio/i15bis_engine_loop.wav',pv1Gun:'./audio/pv1_gun_shot.wav',f86Gun:'./audio/f86_gun_shot.wav',b29Gun:'./audio/b29_gun_shot.wav',mig23Gun:'./audio/mig23_gun_shot.wav',mig37Gun:'./audio/mig37_gun_shot.wav',meteorGun:'./audio/meteor20_gun_shot.wav',bombDrop:'./audio/bomb_drop.mp3',kill:'./audio/kill_confirm.mp3'};
const AUDIO_VOLUMES={f86Gun:.42,b29Gun:.48,pv1Gun:.42,mig23Gun:.53,mig37Gun:.47,meteorGun:.5,bombDrop:.66,kill:.7};
const audioPools=Object.create(null),audioLastPlayed=Object.create(null),audioBuffers=new Map(),audioLoads=new Map(),gunVoices=new Set();
let audioPrepared=false,audioContext=null,audioMaster=null,engineAudio=null,engineAudioType=null,engineGeneration=0,engineStartPending=false,nextGunStart=new WeakMap(),damageFlashTimer=null,damageFlashNextAt=0;

function prepareGameAudio(){
 if(audioPrepared)return;audioPrepared=true;
 const Context=window.AudioContext||window.webkitAudioContext;
 if(Context)try{
  audioContext=new Context();audioMaster=audioContext.createDynamicsCompressor();
  audioMaster.threshold.value=-6;audioMaster.knee.value=8;audioMaster.ratio.value=8;audioMaster.attack.value=.003;audioMaster.release.value=.1;audioMaster.connect(audioContext.destination)
 }catch(error){audioContext=null;console.warn('使用短片段音频备用播放',error)}
 for(const[name,path]of Object.entries(AUDIO_FILES)){
  if(name==='bombDrop'||name==='kill'||!audioContext){const clip=new Audio(path);clip.preload='auto';clip.load();audioPools[name]=[clip]}
  if(audioContext&&name!=='bombDrop'&&name!=='kill')loadAudioBuffer(name)
 }
}
function loadAudioBuffer(name){
 if(audioBuffers.has(name))return Promise.resolve(audioBuffers.get(name));
 if(audioLoads.has(name))return audioLoads.get(name);
 const promise=fetch(AUDIO_FILES[name]).then(response=>{if(!response.ok)throw new Error('音频无法读取：'+name);return response.arrayBuffer()}).then(raw=>audioContext.decodeAudioData(raw)).then(buffer=>{audioBuffers.set(name,buffer);return buffer}).catch(error=>{console.warn('音频解码失败：'+name,error);return null});
 audioLoads.set(name,promise);return promise
}
function resumeGameAudio(){
 prepareGameAudio();if(audioContext&&audioContext.state==='suspended')audioContext.resume().catch(()=>{})
}
function playSfx(name,minGap=.2){
 prepareGameAudio();const now=performance.now(),prior=audioLastPlayed[name];
 if(prior!==undefined&&now-prior<minGap*1000)return;audioLastPlayed[name]=now;
 const pool=audioPools[name]||(audioPools[name]=[]);let voice=pool.find(item=>item.paused||item.ended);
 if(!voice&&pool.length<6){voice=new Audio(AUDIO_FILES[name]);voice.preload='auto';pool.push(voice)}
 if(!voice)voice=pool.reduce((old,item)=>item.currentTime>old.currentTime?item:old,pool[0]);
 voice.pause();voice.currentTime=0;voice.loop=false;voice.volume=AUDIO_VOLUMES[name]??.5;
 const promise=voice.play();if(promise?.catch)promise.catch(()=>{})
}
function releaseGunVoice(voice){
 gunVoices.delete(voice);if(voice.source)try{voice.source.disconnect();voice.gain.disconnect()}catch{}
}
function playGunShot(name,root,isEnemy,interval,automatic=false){
 if(!playing)return;prepareGameAudio();
 const volume=(AUDIO_VOLUMES[name]??.42)*(isEnemy?.35:1),buffer=audioBuffers.get(name);
 // Unloaded/suspended Web Audio never queues stale shots for later replay.
 if(audioContext){
  if(audioContext.state!=='running'||!buffer)return;
  const now=audioContext.currentTime,perRoot=nextGunStart.get(root)||new Map();nextGunStart.set(root,perRoot);
  const start=Math.min(Math.max(now,perRoot.get(name)||now),now+.10);perRoot.set(name,start+interval);
  const source=audioContext.createBufferSource(),gain=audioContext.createGain();source.buffer=buffer;source.loop=false;gain.gain.value=volume;source.connect(gain);gain.connect(audioMaster);
  const voice={source,gain,start,isEnemy,automatic};gunVoices.add(voice);source.onended=()=>releaseGunVoice(voice);source.start(start);
 }else{
  // Older WebViews still play a single short WAV, never the original burst.
  const clip=new Audio(AUDIO_FILES[name]);clip.volume=volume;clip.loop=false;
  const voice={element:clip,start:0,isEnemy,automatic};gunVoices.add(voice);clip.onended=()=>releaseGunVoice(voice);
  clip.play().catch(()=>releaseGunVoice(voice))
 }
 if(gunVoices.size>48){const oldest=gunVoices.values().next().value;if(oldest.source){try{oldest.source.stop()}catch{}}else oldest.element.pause();releaseGunVoice(oldest)}
}
function stopPendingGunSounds(){
 if(keys.fire)return;const now=audioContext?.currentTime||0;
 for(const voice of [...gunVoices])if(!voice.isEnemy&&!voice.automatic&&voice.source&&voice.start>now+.001){try{voice.source.stop()}catch{};releaseGunVoice(voice)}
 if(player)nextGunStart.delete(player)
}
function stopGunSounds(){
 for(const voice of [...gunVoices]){
  if(voice.source){const now=audioContext.currentTime;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(0,now,.004);try{voice.source.stop(now+.016)}catch{}}
  else{voice.element.pause();releaseGunVoice(voice)}gunVoices.delete(voice)
 }
 nextGunStart=new WeakMap()
}
function stopEngineSound(){
 engineGeneration++;engineStartPending=false;
 if(engineAudio){
  const voice=engineAudio;
  if(voice.source){const now=audioContext.currentTime;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(0,now,.012);try{voice.source.stop(now+.06)}catch{}}
  else{voice.element.pause();voice.element.currentTime=0}
 }
 engineAudio=null;engineAudioType=null
}
function startEngineSound(type){
 resumeGameAudio();const kind=type==='b29'?'b29':PROPELLER_SPECS[type]?'prop':'jet';
 if(engineAudioType===kind&&(engineAudio||engineStartPending))return;
 stopEngineSound();engineAudioType=kind;const generation=engineGeneration,name=kind==='b29'?'b29Engine':kind==='prop'?'i15Engine':'jetEngine';engineStartPending=true;
 const begin=buffer=>{
  if(generation!==engineGeneration)return;
  if(!playing||!player||(player.userData.engineRunning===false&&(kind!=='prop'||(player.userData.propRpm||0)===0))){engineStartPending=false;engineAudioType=null;return}
  engineStartPending=false;
  if(audioContext&&buffer){
   const source=audioContext.createBufferSource(),gain=audioContext.createGain();source.buffer=buffer;source.loop=true;source.loopStart=0;source.loopEnd=buffer.duration;
   gain.gain.value=0;source.connect(gain);gain.connect(audioMaster);const voice={source,gain};engineAudio=voice;
   source.onended=()=>{try{source.disconnect();gain.disconnect()}catch{}};source.start();updateEngineAudio()
  }else{
   const element=new Audio(AUDIO_FILES[name]);element.loop=true;element.preload='auto';element.volume=0;engineAudio={element};updateEngineAudio();element.play().catch(()=>{})
  }
 };
 if(audioContext){const buffer=audioBuffers.get(name);if(buffer)begin(buffer);else loadAudioBuffer(name).then(begin)}else begin(null)
}
function updateEngineAudio(){
 if(!engineAudio||!player)return;
 const data=player.userData,throttle=THREE.MathUtils.clamp(data.throttle??throttleValue,0,1);let volume,rate;
 if(engineAudioType==='prop'){
  const fraction=THREE.MathUtils.clamp((data.propRpm||0)/PROPELLER_SPECS[playerPlane].maxRpm,0,1);
  volume=(.10+fraction*.24)*THREE.MathUtils.smoothstep(fraction,0,.15);rate=.65+fraction*.52;
  if(!data.engineRunning&&(data.propRpm||0)===0){stopEngineSound();return}
 }else{
  if(!data.engineRunning){stopEngineSound();return}
  volume=engineAudioType==='b29'?.27+throttle*.17:.13+throttle*.13;rate=.84+.30*throttle
 }
 if(engineAudio.source){const now=audioContext.currentTime;engineAudio.gain.gain.setTargetAtTime(volume,now,.06);engineAudio.source.playbackRate.setTargetAtTime(rate,now,.1)}
 else{engineAudio.element.volume=volume;engineAudio.element.playbackRate=rate}
}

function updateEngineUI(){const button=$('#engineToggle'),display=$('#propRpm'),spec=PROPELLER_SPECS[playerPlane];button.classList.toggle('hidden',!spec);display.classList.toggle('hidden',!spec);if(!spec||!player)return;button.textContent=player.userData.engineRunning?'关闭发动机':'启动发动机';button.setAttribute('aria-pressed',String(player.userData.engineRunning));display.textContent='螺旋桨 '+Math.round(player.userData.propRpm)+' RPM'}
function togglePlayerEngine(){if(!playing||!player||!PROPELLER_SPECS[playerPlane]||player.userData.destroyed)return;player.userData.engineRunning=!player.userData.engineRunning;if(player.userData.engineRunning)startEngineSound(playerPlane);updateEngineUI();toast(player.userData.engineRunning?'发动机启动':'发动机关闭')}
function gunSoundFor(type,id){if(type==='i16')return'pv1Gun';if(type==='i15')return'pv1Gun';if(type==='mig3')return'pv1Gun';if((type==='p36a'||type==='f3f2')&&id==='m2')return'f86Gun';if(type==='i15bis'||type==='bf109b1'||type==='p36a'||type==='f3f2')return'pv1Gun';if(type==='b29')return'b29Gun';if(type==='f86')return'f86Gun';if(id==='n37')return'mig37Gun';if(type==='meteor'||id==='hispano')return'meteorGun';if(type==='mig15'||id==='ns23')return'mig23Gun';return'f86Gun'}
function advanceAircraft(aircraft,dt){
 const count=Math.max(1,Math.ceil(dt/FLIGHT_PHYSICS.stepSeconds)),step=dt/count;
 for(let i=0;i<count;i++){integrateAircraftFlight(aircraft,step);enforceAICeiling(aircraft)}
 return aircraft.userData.airspeed
}
// Fighter tactics use the same steering and flight dynamics as the player.
function initializeFighterAI(root,role,index=0){
 root.userData.engineRunning=true;
 root.userData.ai={role,index,state:'GUARD',stateAge:0,decisionRemaining:0,goal:root.position.clone(),breakGoal:null,fireIntent:{},telemetry:null,targetAcquired:false,escortThreat:false,unsafeSeconds:0,stableSeconds:0,formationOffset:new THREE.Vector3(),recoveries:0};
 return root.userData.ai
}
function changeAIState(ai,state,force=false){
 if(ai.state===state)return false;
 if(!force&&ai.stateAge<(AI_TACTICS.minStateSeconds[ai.state]||0))return false;
 ai.state=state;ai.stateAge=0;ai.decisionRemaining=0;
 if(state!=='BREAK')ai.breakGoal=null;
 return true
}
function muzzleWorldPoint(root,spec){
 const first=spec.offsets[0],offset=new THREE.Vector3(first[0],first[1],first[2]).multiplyScalar(root.scale.x);
 return root.position.clone().add(offset.applyQuaternion(root.quaternion))
}
function solveBulletIntercept(origin,targetPosition,targetVelocity,bulletSpeed){
 const displacement=targetPosition.clone().sub(origin),velocity=targetVelocity||new THREE.Vector3(),a=velocity.lengthSq()-bulletSpeed*bulletSpeed,b=2*displacement.dot(velocity),c=displacement.lengthSq();
 let seconds=null;
 if(Math.abs(a)<1e-8){if(Math.abs(b)>1e-8)seconds=-c/b}
 else{const discriminant=b*b-4*a*c;if(discriminant>=0){const root=Math.sqrt(discriminant),one=(-b-root)/(2*a),two=(-b+root)/(2*a);seconds=[one,two].filter(t=>t>0).sort((x,y)=>x-y)[0]??null}}
 if(seconds===null||seconds<=0||seconds>2.1)return null;
 const point=targetPosition.clone().addScaledVector(velocity,seconds),direction=point.clone().sub(origin).normalize();
 return{point,direction,seconds}
}
function terrainLineClear(start,end){
 for(let i=1;i<=6;i++){
  const p=start.clone().lerp(end,i/7);
  if(p.y<terrainHeightAt(p.x,p.z)+2)return false
 }
 return true
}
function safeAIGoal(root,goal){
 const safe=goal.clone(),half=activeMapId==='korea1951'?265:290;
 if(gameMode==='duel'||gameMode==='airspace'){const b=terrainBattleBounds();safe.x=THREE.MathUtils.clamp(safe.x,b.minX,b.maxX);safe.z=THREE.MathUtils.clamp(safe.z,b.minZ,b.maxZ)}
 else if(activeMapId==='korea1951'){safe.x=THREE.MathUtils.clamp(safe.x,-half,half);safe.z=THREE.MathUtils.clamp(safe.z,-half,half)}
 else{const radius=Math.hypot(safe.x,safe.z);if(radius>half){safe.x*=half/radius;safe.z*=half/radius}}
 safe.y=Math.max(safe.y,terrainHeightAt(safe.x,safe.z)+AI_TACTICS.groundClearanceMeters/METERS_PER_UNIT);
 const predicted=root.position.clone().addScaledVector(root.userData.velocity,2.5);
 for(let i=1;i<=6;i++){
  const fraction=i/6,p=root.position.clone().lerp(safe,fraction),floor=terrainHeightAt(p.x,p.z)+AI_TACTICS.groundClearanceMeters/METERS_PER_UNIT;
  if(p.y<floor)safe.y=Math.max(safe.y,root.position.y+(floor-p.y)/Math.max(fraction,.15))
 }
 const predictedFloor=terrainHeightAt(predicted.x,predicted.z)+AI_TACTICS.groundClearanceMeters/METERS_PER_UNIT;
 if(predicted.y<predictedFloor)safe.y=Math.max(safe.y,predictedFloor+12);
 safe.y=Math.min(safe.y,AI_TACTICS.maxAltitudeMeters/METERS_PER_UNIT-90-5);
 return safe
}
function chooseAIBreakPoint(root,target,center){
 const forward=new THREE.Vector3(0,0,-1).applyQuaternion(root.quaternion).setY(0).normalize(),right=new THREE.Vector3(1,0,0).applyQuaternion(root.quaternion).setY(0).normalize(),fromTarget=root.position.clone().sub(target.position),side=right.dot(fromTarget)>=0?1:-1;
 let goal=root.position.clone().addScaledVector(forward,105).addScaledVector(right,side*90).add(new THREE.Vector3(0,45,0));
 if(goal.distanceTo(center)*METERS_PER_UNIT>AI_TACTICS.escortLeashMeters&&root.userData.ai.role==='escort')goal=center.clone().add(new THREE.Vector3(side*30,35,0));
 return safeAIGoal(root,goal)
}
function aiFormationGoal(root,formationRoot,seconds){
 const offset=root.userData.ai.formationOffset.clone().applyQuaternion(formationRoot.quaternion);
 return formationRoot.position.clone().addScaledVector(formationRoot.userData.velocity,seconds).add(offset)
}
function decideFighterAI(root,target,center){
 const ai=root.userData.ai,type=root.userData.type,config=AI_FIGHTER[type],toTarget=target.position.clone().sub(root.position),distance=toTarget.length()*METERS_PER_UNIT,fromCenter=root.position.distanceTo(center)*METERS_PER_UNIT,targetFromCenter=target.position.distanceTo(center)*METERS_PER_UNIT,ammo=ai.role==='escort'||ai.role==='airspace'?root.userData.ammo:enemyAmmo,mode=ai.role==='escort'||ai.role==='airspace'?root.userData.weaponMode:enemyWeaponMode;
 const forward=new THREE.Vector3(0,0,-1).applyQuaternion(root.quaternion),alignment=distance>1?forward.dot(toTarget.clone().normalize()):0,local=toTarget.clone().applyQuaternion(root.quaternion.clone().invert());
 // Separate enter and exit ranges prevent a target at the 3 km boundary from
 // repeatedly flipping between GUARD and INTERCEPT.
 ai.targetAcquired=ai.targetAcquired?distance<config.loseMeters:distance<config.detectMeters;
 if(ai.role==='escort')ai.escortThreat=ai.escortThreat?targetFromCenter<AI_TACTICS.escortTargetExitMeters:targetFromCenter<AI_TACTICS.escortEngageMeters;
 const available=ai.targetAcquired&&(ai.role!=='escort'||ai.escortThreat);
 if(ai.state==='RECOVER'){
  if(ai.stateAge>=AI_TACTICS.minStateSeconds.RECOVER&&ai.stableSeconds>=AI_TACTICS.recoveryStableSeconds)changeAIState(ai,ai.role==='escort'?'REJOIN':available?'INTERCEPT':'GUARD',true)
 }else if(ai.role==='escort'&&fromCenter>=AI_TACTICS.escortReturnTriggerMeters&&ai.state!=='REJOIN')changeAIState(ai,'REJOIN',true);
 else if(ai.state==='BREAK'){
  if(ai.stateAge>=AI_TACTICS.minStateSeconds.BREAK&&(ai.stateAge>2.1||distance>config.alignMeters))changeAIState(ai,ai.role==='escort'?'REJOIN':available?'INTERCEPT':'GUARD')
 }else if(!available){
  const fallback=ai.role==='escort'&&(ai.state==='GUARD'||ai.state==='REJOIN'&&fromCenter<AI_TACTICS.escortReturnMeters)?'GUARD':ai.role==='escort'?'REJOIN':'GUARD';
  if(ai.state!==fallback)changeAIState(ai,fallback,true)
 }else if(ai.state==='GUARD')changeAIState(ai,'INTERCEPT');
 else if(ai.state==='REJOIN'){
  if(ai.role==='duel'||fromCenter<AI_TACTICS.escortReturnMeters)changeAIState(ai,'INTERCEPT')
 }else if(ai.state==='INTERCEPT'){
  if(distance<config.alignMeters&&local.z<0)changeAIState(ai,'ALIGN')
 }else if(ai.state==='ALIGN'){
  if(distance>config.alignMeters*1.4||local.z>0)changeAIState(ai,'INTERCEPT',true);
  else if(alignment>.97&&distance<config.alignMeters*.9)changeAIState(ai,'FIRE_PASS')
 }else if(ai.state==='FIRE_PASS'&&(ai.stateAge>config.passSeconds||distance<config.breakMeters||local.z>12)){
  if(changeAIState(ai,'BREAK'))ai.breakGoal=chooseAIBreakPoint(root,target,center)
 }
 if(ai.state==='BREAK'&&!ai.breakGoal)ai.breakGoal=chooseAIBreakPoint(root,target,center);
 if(ai.state==='BREAK')ai.goal=ai.breakGoal.clone();
 else if(ai.state==='REJOIN'&&ai.role==='escort'&&ai.formationRoot)ai.goal=aiFormationGoal(root,ai.formationRoot,THREE.MathUtils.clamp(fromCenter/Math.max(root.userData.airspeed,1),4,8));
 else if(ai.state==='GUARD'&&ai.role==='escort'&&ai.formationRoot)ai.goal=aiFormationGoal(root,ai.formationRoot,5);
 else if(ai.state==='REJOIN'||ai.state==='GUARD')ai.goal=AI_DUEL_CENTER.clone().add(new THREE.Vector3(45*Math.cos(worldTime*.15),10,45*Math.sin(worldTime*.15)));
 else if(ai.state==='RECOVER')ai.goal=root.position.clone().addScaledVector(root.userData.velocity,3);
 else if(ai.state==='INTERCEPT')ai.goal=target.position.clone().addScaledVector(target.userData.velocity,Math.min(distance/Math.max(root.userData.airspeed,1),1.4));
 else{
  const id=selectedWeaponIds(type,mode).find(name=>weaponInfo[type]?.[name]&&ammo?.[name]>=weaponInfo[type][name].cost),spec=weaponInfo[type]?.[id],intercept=spec&&solveBulletIntercept(muzzleWorldPoint(root,spec),target.position,target.userData.velocity,spec.speed/METERS_PER_UNIT);
  ai.goal=intercept?.point||target.position.clone()
 }
 ai.goal=safeAIGoal(root,ai.goal);
 ai.telemetry={state:ai.state,distanceMeters:distance,escortDistanceMeters:fromCenter,targetFromCenterMeters:targetFromCenter,goal:ai.goal.clone(),headingVelocityDot:ai.headingVelocityDot,lateralVelocityMps:ai.lateralVelocityMps,recoveries:ai.recoveries,armed:selectedWeaponIds(type,mode).some(id=>weaponInfo[type]?.[id]&&ammo?.[id]>=weaponInfo[type][id].cost)}
}
function aiFireIntent(root,target){
 const data=root.userData,ai=data.ai,type=data.type,config=AI_FIGHTER[type],mode=ai.role==='escort'||ai.role==='airspace'?data.weaponMode:enemyWeaponMode,ammo=ai.role==='escort'||ai.role==='airspace'?data.ammo:enemyAmmo,forward=new THREE.Vector3(0,0,-1).applyQuaternion(root.quaternion).normalize(),local=target.position.clone().sub(root.position).applyQuaternion(root.quaternion.clone().invert()),intent={};
 if(data.boundaryReturning||data.instructorRecovering||ai.state!=='FIRE_PASS'||local.z>=0)return intent;
 for(const id of selectedWeaponIds(type,mode)){
  const spec=weaponInfo[type]?.[id],gun=config.gun[id];if(!spec||!gun||ammo?.[id]<spec.cost)continue;
  const origin=muzzleWorldPoint(root,spec),intercept=solveBulletIntercept(origin,target.position,target.userData.velocity,spec.speed/METERS_PER_UNIT);
  if(!intercept||origin.distanceTo(target.position)*METERS_PER_UNIT>gun.rangeMeters)continue;
  const alignment=forward.dot(intercept.direction),cone=Math.cos(THREE.MathUtils.degToRad(gun.coneDeg));
  if(alignment<cone||!terrainLineClear(origin,intercept.point))continue;
  intent[id]=true
 }
 ai.fireIntent=intent;return intent
}
function recoverAircraftAttitude(root,dt){
 const travel=root.userData.velocity.clone();if(travel.lengthSq()<.001)return;
 steerAircraftToward(root,travel.normalize(),dt)
}
function updateFighterAI(root,target,center,dt,orderGoal=null){
 const data=root.userData,ai=data.ai;if(!ai||!target)return;
 ai.stateAge+=dt;ai.decisionRemaining-=dt;
 const forward=new THREE.Vector3(0,0,-1).applyQuaternion(root.quaternion),travel=data.velocity.clone(),speed=travel.length()*METERS_PER_UNIT;
 ai.headingVelocityDot=speed>.5?forward.dot(travel.normalize()):1;
 ai.lateralVelocityMps=data.velocity.dot(new THREE.Vector3(1,0,0).applyQuaternion(root.quaternion))*METERS_PER_UNIT;
 const unsafe=ai.headingVelocityDot<AI_TACTICS.recoveryEnterDot||speed<data.minFlightSpeedMps*.68;
 ai.unsafeSeconds=unsafe?ai.unsafeSeconds+dt:Math.max(0,ai.unsafeSeconds-dt*2);
 ai.stableSeconds=ai.headingVelocityDot>AI_TACTICS.recoveryExitDot&&speed>data.minFlightSpeedMps*.9?ai.stableSeconds+dt:0;
 if(ai.state!=='RECOVER'&&(ai.headingVelocityDot<0||ai.unsafeSeconds>=AI_TACTICS.recoveryEnterSeconds)){
  changeAIState(ai,'RECOVER',true);ai.recoveries++;ai.stableSeconds=0
 }
 if(ai.decisionRemaining<=0){decideFighterAI(root,target,center);do{ai.decisionRemaining+=AI_TACTICS.decisionSeconds}while(ai.decisionRemaining<=0)}
 const toGoal=safeAIGoal(root,orderGoal||ai.goal).sub(root.position),goalAlignment=toGoal.lengthSq()>.001?forward.dot(toGoal.clone().normalize()):1;
 if(ai.role==='escort'){
  const slotDistance=ai.formationRoot?root.position.distanceTo(aiFormationGoal(root,ai.formationRoot,2))*METERS_PER_UNIT:0;
  let desiredKmh;
  if(ai.state==='REJOIN')desiredKmh=slotDistance>300&&goalAlignment>.65?THREE.MathUtils.clamp(430+slotDistance*.18,430,650):THREE.MathUtils.clamp(320+slotDistance*.18,320,500);
  else if(ai.state==='GUARD')desiredKmh=THREE.MathUtils.clamp(320+slotDistance*.20,320,450);
  else desiredKmh=data.campaignCruiseKmh+60;
  data.throttle=ai.state==='RECOVER'?.95:THREE.MathUtils.clamp(desiredKmh/planeInfo.f86.maxSpeedKmh,.27,.9)
 }else if(ai.role==='airspace'&&orderGoal)data.throttle=ai.state==='RECOVER'?.95:data.airspaceNavigationThrottle;else data.throttle=ai.state==='RECOVER'?.95:THREE.MathUtils.clamp(.78+(ai.state==='INTERCEPT'||ai.state==='FIRE_PASS'?.11:0),.35,.95);
 const boundaryGoal=duelBoundaryReturnGoal(root),direction=ai.role==='airspace'&&orderGoal?airspaceFlightDirection(root,boundaryGoal||safeAIGoal(root,orderGoal)):boundaryGoal?boundaryGoal.sub(root.position):toGoal;
 const count=Math.max(1,Math.ceil(dt/FLIGHT_PHYSICS.stepSeconds)),step=dt/count;
 for(let i=0;i<count;i++){
  if(ai.state==='RECOVER'&&!boundaryGoal)recoverAircraftAttitude(root,step);
  else if(direction.lengthSq()>.001)steerAircraftToward(root,direction,step);
  advanceAircraft(root,step);enforceDuelAIBoundary(root)
 }
 if(ai.telemetry)ai.telemetry.boundaryReturning=!!data.boundaryReturning;
 const actualForward=new THREE.Vector3(0,0,-1).applyQuaternion(root.quaternion),actualSpeed=data.velocity.length();
 ai.headingVelocityDot=actualSpeed>.001?actualForward.dot(data.velocity.clone().divideScalar(actualSpeed)):1;
 ai.lateralVelocityMps=data.velocity.dot(new THREE.Vector3(1,0,0).applyQuaternion(root.quaternion))*METERS_PER_UNIT;
 if(ai.telemetry){ai.telemetry.headingVelocityDot=ai.headingVelocityDot;ai.telemetry.lateralVelocityMps=ai.lateralVelocityMps;ai.telemetry.speedKmh=data.airspeed*3.6;ai.telemetry.throttle=data.throttle;ai.telemetry.unsafeSeconds=ai.unsafeSeconds}
 fireWeapons(root,true,dt,orderGoal?false:aiFireIntent(root,target))
}
function updateDuelEnemy(dt){
 if(!enemy)return;
 if(enemyPlaneType==='b29'){
  enemy.userData.patrolPhase+=dt*.15;
  const goal=safeAIGoal(enemy,AI_DUEL_CENTER.clone().add(new THREE.Vector3(55*Math.sin(enemy.userData.patrolPhase),12,55*Math.cos(enemy.userData.patrolPhase))));
  const boundaryGoal=duelBoundaryReturnGoal(enemy),direction=(boundaryGoal||goal).sub(enemy.position);
  const count=Math.max(1,Math.ceil(dt/FLIGHT_PHYSICS.stepSeconds)),step=dt/count;
  for(let i=0;i<count;i++){steerAircraftToward(enemy,direction,step);advanceAircraft(enemy,step);enforceDuelAIBoundary(enemy)}
 }else updateFighterAI(enemy,player,AI_DUEL_CENTER,dt);
 enforceDuelAIBoundary(enemy);
 if(enemy&&enemy.position.y<terrainHeightAt(enemy.position.x,enemy.position.z))damage('enemy',eHp)
}
function updateNonAirspaceStep(dt){
  battleRewardSeconds+=dt;
  worldTime+=dt;rememberAircraftFrameStart();updateAllPropellers(dt);updatePlayerFlightControls(dt);
  if(player.position.y<terrainHeightAt(player.position.x,player.position.z)){hp=0;updateHealthUI();finish(false)}
  if(playing){if(gameMode==='campaign')updateCampaign(dt);else updateDuelEnemy(dt)}
  if(playing)updateDuelBoundary(dt);
  if(playing){
   updateCursorTarget(dt);fireWeapons(player,false,dt,keys.fire);if(keys.bomb&&!bombKeyWasDown)dropBomb();bombKeyWasDown=keys.bomb;updateDroppedBombs(dt);
   if(gameMode==='duel'){fireBomberTurrets(player,false,dt);fireBomberTurrets(enemy,true,dt)}
   const campaignShotTargets=gameMode==='campaign'?campaignTargets():null;for(let i=bullets.length-1;i>=0;i--){const bullet=bullets[i];(bullet.previousPosition??=new THREE.Vector3()).copy(bullet.mesh.position);const shotStep=Math.min(dt,Math.max(0,bullet.life));bullet.mesh.position.addScaledVector(bullet.dir,bullet.speed*shotStep);bullet.life-=dt;let hit=false;if(bullet.enemy){if(sweptAircraftHit(bullet.previousPosition,bullet.mesh.position,player,bullet.radius)){damage('player',bullet.damage);hit=true}}else if(gameMode==='campaign'){for(const target of campaignShotTargets){if(sweptAircraftHit(bullet.previousPosition,bullet.mesh.position,target.root,bullet.radius)){damage('enemy',bullet.damage,target);hit=true;break}}}else if(enemy&&sweptAircraftHit(bullet.previousPosition,bullet.mesh.position,enemy,bullet.radius)){damage('enemy',bullet.damage);hit=true}if(hit||bullet.life<=0)releaseBullet(i);if(!playing)break}
  }
}
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
 if(!unlockedPlanes.includes('mig15')){toast('请先研发并购买 MiG-15');showMenuScreen('research');return}
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

function animate(){
 requestAnimationFrame(animate);if(!scene)return;
 const elapsed=Math.max(0,clock.getDelta()),visualDt=Math.min(elapsed,.1);
 if(gameMode==='airspace'&&airspaceState)advanceAirspaceSimulation(elapsed);else if(playing)advanceBattleSimulation(elapsed);else worldTime+=elapsed;
 applyBattleRenderPose();
 try{
  if(gameMode==='airspace'&&airspaceState){updateAirspaceFrame(0,visualDt);updateAllPropellers(visualDt)}
  else if(player&&camera){
   updateChaseCamera(visualDt);
   if(playing&&shouldUpdateBattleHUD(visualDt)){
    if(gameMode==='campaign')updateCampaignHud();updateTacticalDisplay();$('#speed').textContent=Math.round(player.userData.airspeed*3.6);$('#throttlePercent').textContent=Math.round(throttleValue*100)+'%';$('#throttleControl').setAttribute('aria-valuenow',String(Math.round(throttleValue*100)));$('#alt').textContent=Math.max(0,Math.round((player.position.y+90)*METERS_PER_UNIT))+' m';const degrees=player.userData.aoa*180/Math.PI;$('#aoa').textContent=degrees.toFixed(1)+'°';$('#aoa').classList.toggle('warning',Math.abs(degrees)>14);
    if(PROPELLER_SPECS[playerPlane])updateEngineUI()
   }
   if(playing)updateEngineAudio()
  }
  clouds.forEach(cloud=>{cloud.position.x+=cloud.userData.drift*visualDt;if(cloud.position.x>cloud.userData.range)cloud.position.x=-cloud.userData.range});renderer.render(scene,camera);
  if(previewRenderer&&!$('#encyclopedia').classList.contains('hidden')){if(previewPlane)previewPlane.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),worldTime*.32);previewCamera.lookAt(0,0,0);previewRenderer.render(previewScene,previewCamera)}
 }finally{restoreBattlePhysicsPose()}
}
// One owned aircraft opens the next BR stage, across all national branches.
const RESEARCH_COSTS={
 i15:{rp:0,gp:0},i15bis:{rp:0,gp:0},
 f3f2:{rp:400,gp:1200},bf109b1:{rp:500,gp:1400},i16:{rp:500,gp:1400},p36a:{rp:550,gp:1600},
 mig3:{rp:1600,gp:4500},b29:{rp:4800,gp:14000},
 meteor:{rp:7000,gp:22000},mig15:{rp:7500,gp:24000},f86:{rp:7800,gp:26000}
};
const ECONOMY_RULES={startGP:2000,maxBalance:999999999,killRP:80,killGP:200,winRP:120,winGP:400,lossRP:30,lossGP:100,timeRP:.3,timeGP:.8,maxRewardSeconds:300,minResultSeconds:20};
let economy={rp:0,gp:ECONOMY_RULES.startGP,research:{},completedSorties:0};
let battleRewardSeconds=0,battleRewardSettled=true;
function economyInteger(value,maximum=ECONOMY_RULES.maxBalance){return Number.isFinite(value)?Math.min(maximum,Math.max(0,Math.floor(value))):0}
function loadProgressionProfile(){
 let saved=null;try{saved=JSON.parse(localStorage.getItem(PROFILE_KEY)||'null')}catch{}
 if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};
 const preserved=Array.isArray(saved.unlocked)?saved.unlocked.filter(id=>typeof id==='string'&&AIRCRAFT_SPECS[id]):[];
 unlockedPlanes=[...new Set(['i15','i15bis',...preserved])];
 selectedAircraft=unlockedPlanes.includes(saved.selected)?saved.selected:'i15';
 if(BOMBER_LOADOUTS[saved.bomberLoadout])selectedBombPayload=saved.bomberLoadout;
 const wallet=saved.economy;
 if(wallet&&typeof wallet==='object'&&!Array.isArray(wallet)){
  economy={rp:economyInteger(wallet.rp),gp:economyInteger(wallet.gp),research:{},completedSorties:economyInteger(wallet.completedSorties)};
  if(wallet.research&&typeof wallet.research==='object')for(const[type,value]of Object.entries(wallet.research))if(RESEARCH_COSTS[type])economy.research[type]=economyInteger(value,RESEARCH_COSTS[type].rp)
 }else economy={rp:0,gp:ECONOMY_RULES.startGP,research:{},completedSorties:0};
 playerPlane=selectedAircraft;saveHangar()
}
function researchStages(){return[...new Set(Object.values(AIRCRAFT_TREE).map(info=>info.rating))].sort((a,b)=>a-b)}
function researchPrerequisite(type){
 const rating=AIRCRAFT_TREE[type]?.rating;if(!Number.isFinite(rating))return{allowed:false,rating:null,choices:[]};
 const prior=researchStages().filter(value=>value<rating-1e-9).at(-1);
 if(prior===undefined)return{allowed:true,rating:null,choices:[]};
 const choices=Object.keys(AIRCRAFT_TREE).filter(id=>Math.abs(AIRCRAFT_TREE[id].rating-prior)<1e-9);
 return{allowed:choices.some(id=>unlockedPlanes.includes(id)),rating:prior,choices}
}
function aircraftResearchState(type){
 const cost=RESEARCH_COSTS[type];if(!cost)return{status:'invalid'};
 const owned=unlockedPlanes.includes(type),progress=owned?cost.rp:economyInteger(economy.research[type],cost.rp),prerequisite=researchPrerequisite(type);
 return{status:owned?'owned':!prerequisite.allowed?'blocked':progress>=cost.rp?'ready':'research',owned,progress,cost,prerequisite}
}
function investAircraftResearch(type){
 const state=aircraftResearchState(type);if(state.status!=='research')return{ok:false,reason:state.status};
 const amount=Math.min(economy.rp,state.cost.rp-state.progress);if(amount<=0)return{ok:false,reason:'points'};
 economy.rp-=amount;economy.research[type]=state.progress+amount;saveHangar();return{ok:true,amount,complete:economy.research[type]===state.cost.rp}
}
function purchaseResearchedAircraft(type){
 const state=aircraftResearchState(type);if(state.status!=='ready')return{ok:false,reason:state.status};
 if(economy.gp<state.cost.gp)return{ok:false,reason:'gp'};
 economy.gp-=state.cost.gp;unlockedPlanes.push(type);saveHangar();return{ok:true}
}
function beginSortieEconomy(){battleRewardSeconds=0;battleRewardSettled=false;const reward=$('#sortieRewards');if(reward){reward.textContent='';reward.classList.add('hidden')}}
function settleSortieEconomy(win){
 if(battleRewardSettled)return null;battleRewardSettled=true;
 const seconds=Math.min(ECONOMY_RULES.maxRewardSeconds,Math.max(0,battleRewardSeconds)),confirmedKills=economyInteger(kills,100),eligible=seconds>=ECONOMY_RULES.minResultSeconds||confirmedKills>0;
 const rp=Math.floor(seconds*ECONOMY_RULES.timeRP)+confirmedKills*ECONOMY_RULES.killRP+(eligible?(win===true?ECONOMY_RULES.winRP:ECONOMY_RULES.lossRP):0);
 const gp=Math.floor(seconds*ECONOMY_RULES.timeGP)+confirmedKills*ECONOMY_RULES.killGP+(eligible?(win===true?ECONOMY_RULES.winGP:ECONOMY_RULES.lossGP):0);
 economy.rp=economyInteger(economy.rp+rp);economy.gp=economyInteger(economy.gp+gp);economy.completedSorties=economyInteger(economy.completedSorties+1);saveHangar();updateEconomyDisplay();
 const reward=$('#sortieRewards');if(reward){reward.textContent=`本局获得 ${rp} 研发点 · ${gp} GP`;reward.classList.remove('hidden')}
 return{rp,gp,seconds,kills:confirmedKills}
}
function updateEconomyDisplay(){
 document.querySelectorAll('[data-wallet-rp]').forEach(node=>node.textContent=economy.rp.toLocaleString('zh-CN'));
 document.querySelectorAll('[data-wallet-gp]').forEach(node=>node.textContent=economy.gp.toLocaleString('zh-CN'));
 const campaignOwned=unlockedPlanes.includes('mig15'),choose=$('#chooseCampaign'),begin=$('#beginCampaign'),use=$('#useCatalogPlane');
 if(choose){choose.disabled=!campaignOwned;const label=choose.querySelector('span');if(label)label.textContent=campaignOwned?'米格之舞 · 1951·朝鲜 · 6×6公里':'需先研发并购买 MiG-15'}
 if(begin&&$('#battleLoading')?.classList.contains('hidden'))begin.disabled=!campaignOwned;
 if(use){use.disabled=!unlockedPlanes.includes(previewType);use.textContent=use.disabled?'请先在研发中解锁':'设为出战机'}
}
function handleResearchAircraft(type){
 const state=aircraftResearchState(type);
 if(state.status==='owned'){setSelectedAircraft(type);renderResearch();return}
 if(state.status==='blocked'){toast('先解锁一架 BR '+state.prerequisite.rating.toFixed(1)+' 飞机');return}
 if(state.status==='research'){
  const result=investAircraftResearch(type);toast(result.ok?(result.complete?'研发完成，使用 GP 购买入库':'已投入 '+result.amount+' 研发点'):'研发点不足，请完成对局获得研发点')
 }else if(state.status==='ready'){
  const result=purchaseResearchedAircraft(type);if(result.ok){setSelectedAircraft(type);toast(planeInfo[type].name+' 已入库')}else toast('GP 不足，请完成对局获得 GP')
 }
 updateEconomyDisplay();renderHangar();renderResearch()
}
function treeVehicleCard(type){
 const tree=AIRCRAFT_TREE[type],selected=selectedAircraft===type,state=aircraftResearchState(type),blocked=state.status==='blocked';
 let status,action;
 if(state.owned){status=selected?'当前出战':'已入库';action='选择出战'}
 else if(blocked){status='需先入库任一 BR '+state.prerequisite.rating.toFixed(1)+' 飞机';action='前置未解锁'}
 else if(state.status==='ready'){status='研发完成 · '+state.cost.gp.toLocaleString('zh-CN')+' GP';action=economy.gp>=state.cost.gp?'购买入库':'GP 不足'}
 else{status=state.progress+' / '+state.cost.rp+' 研发点 · '+state.cost.gp.toLocaleString('zh-CN')+' GP';action=economy.rp>0?'投入研发点':'等待研发点'}
 return '<button class="tech-node'+(selected?' selected':'')+(blocked?' research-blocked':'')+'" data-tree-plane="'+type+'" aria-pressed="'+selected+'"'+(blocked?' disabled':'')+'><span class="node-art">'+aircraftGlyph(type)+'</span><span class="node-copy"><small>BR '+tree.rating.toFixed(1)+' · '+AIRCRAFT_SPECS[type].lengthMeters.toFixed(2)+' m</small><strong>'+nationFlag(tree.nation)+planeInfo[type].name+'</strong><em>'+status+'</em><span class="research-progress"><i style="width:'+(state.cost.rp?state.progress/state.cost.rp*100:100)+'%"></i></span><span class="research-action">'+action+'</span></span><span class="node-state">'+tree.rank+' 阶</span></button>'
}

function saveHangar(){try{localStorage.setItem(PROFILE_KEY,JSON.stringify({version:2,unlocked:unlockedPlanes,selected:selectedAircraft,bomberLoadout:selectedBombPayload,economy}))}catch{}}
function setSelectedAircraft(type){if(!unlockedPlanes.includes(type))return;stopGunSounds();selectedAircraft=type;playerPlane=type;updateThrottleUI();saveHangar();renderHangar();$('#homeSelectedPlane').textContent=planeInfo[type].name}
function renderHangar(){const host=$('#hangarList');if(!host)return;host.innerHTML=unlockedPlanes.map(type=>{const info=planeInfo[type],tree=AIRCRAFT_TREE[type],active=selectedAircraft===type,payloadEditor=type==='b29'?'<label class="payload-control">炸弹挂载<select data-bomber-loadout>'+Object.entries(BOMBER_LOADOUTS).map(([id,p])=>'<option value="'+id+'"'+(id===selectedBombPayload?' selected':'')+'>'+p.count+' × '+p.eachLb+' 磅</option>').join('')+'</select></label><p class="payload-note">默认18×1000磅；5座炮塔共12挺机枪，备弹12000发。</p>':'';return '<article class="hangar-card'+(active?' selected':'')+'"><h3>'+info.name+'</h3><p>'+tree.nationName+' · BR '+tree.rating.toFixed(1)+' · '+AIRCRAFT_SPECS[type].lengthMeters.toFixed(2)+' m · '+info.maxSpeedKmh+' km/h</p>'+payloadEditor+'<button data-hangar-select="'+type+'">'+(active?'当前出战机':'设为出战机')+'</button></article>'}).join('');host.querySelectorAll('[data-hangar-select]').forEach(b=>b.addEventListener('click',()=>setSelectedAircraft(b.dataset.hangarSelect)));host.querySelector('[data-bomber-loadout]')?.addEventListener('change',event=>{selectedBombPayload=event.target.value;saveHangar();if(playerPlane==='b29'&&playerAmmo?.b29mg!==undefined){playerAmmo.bombs=BOMBER_LOADOUTS[selectedBombPayload].count;playerAmmo.bombWeightLb=BOMBER_LOADOUTS[selectedBombPayload].eachLb;updateAmmoUI()}});$('#homeSelectedPlane').textContent=planeInfo[selectedAircraft].name}
function aircraftGlyph(type){const bomber=type==='b29',outline=bomber?'M60 4 67 19 116 31 116 39 68 34 65 52 82 62 82 66 60 62 38 66 38 62 55 52 52 34 4 39 4 31 53 19Z':'M60 6 66 23 113 36 113 42 67 37 65 55 77 64 77 68 60 64 43 68 43 64 55 55 53 37 7 42 7 36 54 23Z';return '<svg viewBox="0 0 120 72" role="img" aria-label="'+(bomber?'轰炸机':'战斗机')+'轮廓"><defs><linearGradient id="metal-'+type+'" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e0e4d1"/><stop offset=".52" stop-color="#7e958d"/><stop offset="1" stop-color="#3d5559"/></linearGradient></defs><path d="'+outline+'" fill="url(#metal-'+type+')" stroke="#e6ede0" stroke-opacity=".58" stroke-width="1"/><path d="M60 8v51M55 27h10M57 46h6" fill="none" stroke="#31464a" stroke-width="1.5"/><circle cx="60" cy="27" r="2.3" fill="#d4c17b"/></svg>'}
const NATIONAL_FLAGS={
 cn:'<rect width="24" height="16" fill="#de2910"/><path fill="#ffde00" d="m5 2 .8 2.1H8l-1.8 1.3.7 2.1L5 6.2 3.1 7.5l.7-2.1L2 4.1h2.2z"/><circle cx="10" cy="2.5" r=".7" fill="#ffde00"/><circle cx="11.4" cy="4.4" r=".7" fill="#ffde00"/><circle cx="11.2" cy="6.8" r=".7" fill="#ffde00"/><circle cx="9.5" cy="8.7" r=".7" fill="#ffde00"/>',
 us:'<rect width="24" height="16" fill="#fff"/><path stroke="#b22234" stroke-width="1.3" d="M0 .7h24M0 3.2h24M0 5.7h24M0 8.2h24M0 10.7h24M0 13.2h24M0 15.5h24"/><rect width="10" height="8" fill="#3c3b6e"/><path fill="#fff" d="M2 2h1v1H2zm3 0h1v1H5zm3 0h1v1H8zM2 5h1v1H2zm3 0h1v1H5zm3 0h1v1H8z"/>',
 ussr:'<rect width="24" height="16" fill="#ce2028"/><path fill="#ffd700" d="m5 2 .7 2H8L6.1 5.4l.8 2.1L5 6.2 3 7.5l.8-2.1L2 4h2.3z"/><path d="M5 8.5a3 3 0 0 0 4 2M7 7.8l3 3M7 7.8l.8-1" fill="none" stroke="#ffd700" stroke-width="1.1"/>',
 uk:'<rect width="24" height="16" fill="#012169"/><path stroke="#fff" stroke-width="4" d="M0 0 24 16M24 0 0 16"/><path stroke="#c8102e" stroke-width="1.5" d="M0 0 24 16M24 0 0 16"/><path stroke="#fff" stroke-width="5" d="M12 0v16M0 8h24"/><path stroke="#c8102e" stroke-width="2.5" d="M12 0v16M0 8h24"/>',
 de:'<rect width="24" height="5.4" fill="#111"/><rect y="5.3" width="24" height="5.4" fill="#dd0000"/><rect y="10.6" width="24" height="5.4" fill="#ffce00"/>'
};
const NATIONAL_NAMES={cn:'中国',us:'美国',ussr:'苏联',uk:'英国',de:'德国'};
function nationFlag(id){return '<svg class="nation-flag" viewBox="0 0 24 16" role="img" aria-label="'+NATIONAL_NAMES[id]+'国旗">'+NATIONAL_FLAGS[id]+'</svg>'}

function renderResearch(){
 updateEconomyDisplay();const host=$('#researchTree'),owned=$('#researchOwned');if(!host||!owned)return;
 const allNations=[{id:'cn',code:'CHN',name:'中系 · 中国',types:['i15bis']},{id:'us',code:'USA',name:'美系 · 美国',types:['f3f2','p36a','b29','f86']},{id:'ussr',code:'USSR',name:'苏系 · 苏联',types:['i15','i16','mig3','mig15']},{id:'uk',code:'RAF',name:'英系 · 英国',types:['meteor']},{id:'de',code:'GER',name:'德系 · 德国',types:['bf109b1']}];
 const nations=allNations.filter(n=>researchNation==='all'||n.id===researchNation);
 host.innerHTML=nations.map(n=>{
  const ranks=[...new Set(n.types.map(type=>AIRCRAFT_TREE[type].rank))].sort((a,b)=>['I','II','III','IV','V','VI','VII'].indexOf(a)-['I','II','III','IV','V','VI','VII'].indexOf(b));
  const bands=ranks.map(rank=>{
   const types=n.types.filter(type=>AIRCRAFT_TREE[type].rank===rank),branches=[...new Set(types.map(type=>AIRCRAFT_TREE[type].branch))];
   const lanes=branches.map(branch=>'<div class="branch-row"><span class="branch-label">'+branch+'</span><div class="branch-vehicles">'+types.filter(type=>AIRCRAFT_TREE[type].branch===branch).map(treeVehicleCard).join('')+'</div></div>').join('');
   return '<div class="rank-band"><div class="rank-stamp"><b>'+rank+'</b><span>RANK</span></div><div class="rank-lanes">'+lanes+'</div></div>'
  }).join('');
  return '<section class="nation-map"><header class="nation-map-head"><strong>'+nationFlag(n.id)+n.code+'　'+n.name+'</strong><span>'+n.types.length+' 架可用机型</span></header>'+bands+'</section>'
 }).join('');
 const types=nations.flatMap(n=>n.types).filter(type=>unlockedPlanes.includes(type));$('#ownedCount').textContent=String(types.length).padStart(2,'0');
 owned.innerHTML='<div class="owned-list">'+types.map(type=>{
  const tree=AIRCRAFT_TREE[type],selected=selectedAircraft===type;
  return '<button class="owned-node'+(selected?' selected':'')+'" data-tree-plane="'+type+'" aria-pressed="'+selected+'"><span class="node-art">'+aircraftGlyph(type)+'</span><span><strong>'+nationFlag(tree.nation)+planeInfo[type].name+'</strong><small>BR '+tree.rating.toFixed(1)+' · '+tree.rank+' 阶</small></span></button>'
 }).join('')+'</div>';
 document.querySelectorAll('[data-tree-plane]').forEach(button=>button.addEventListener('click',()=>{handleResearchAircraft(button.dataset.treePlane)}));
 document.querySelectorAll('[data-nation-filter]').forEach(button=>{
  const id=button.dataset.nationFilter;
  button.classList.toggle('active',id===researchNation);
  button.innerHTML=id==='all'?'全部国家':nationFlag(id)+allNations.find(n=>n.id===id).name.split(' · ')[0]
 })
}
function showMenuScreen(id){
 airspacePrepareToken++;setBattleLoading(false);$('#beginCampaign').disabled=false;$('#chooseAIBattle').disabled=false;$('#airspaceLoadStatus').textContent='';
stopEngineSound();clearFlightInputs();if(id==='menu')battlePaused=false;playing=false;stopGunSounds();['menu','settings','modeSelect','campaignBriefing','hangar','research','encyclopedia','end'].forEach(n=>$('#'+n).classList.toggle('hidden',n!==id));$('#hud').classList.add('hidden');$('#campaignHud').classList.add('hidden');updateEconomyDisplay();if(id==='hangar')renderHangar();if(id==='research')renderResearch();if(id==='settings')renderControlSettings()}
for(const b of document.querySelectorAll('[data-key]')){const k=b.dataset.key;const down=e=>{if(!playing||gameMode==='airspace'&&airspaceSpectating&&k!=='look'||e.button!==undefined&&e.button!==0)return;e.preventDefault();keys[k]=true;b.classList.add('on');try{b.setPointerCapture(e.pointerId)}catch{}},up=e=>{e.preventDefault();keys[k]=false;b.classList.remove('on')};b.addEventListener('pointerdown',down);b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);b.addEventListener('lostpointercapture',up)}
const keyMap={ArrowUp:'up',w:'up',ArrowDown:'down',s:'down',ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right',' ':'fire',b:'bomb',c:'look'};
const setKey=(e,pressed)=>{if(pressed&&!playing)return;if(gameMode==='airspace'&&airspaceSpectating&&e.key.toLowerCase()!=='c')return;const k=keyMap[e.key]||keyMap[e.key.toLowerCase()];if(!k)return;e.preventDefault();keys[k]=pressed;document.querySelector(`[data-key="${k}"]`)?.classList.toggle('on',pressed)};
window.addEventListener('keydown',e=>{if(playing&&gameMode==='airspace'&&airspaceSpectating&&['q','e'].includes(e.key.toLowerCase())){cycleAirspaceSpectator(e.key.toLowerCase()==='q'?-1:1);e.preventDefault();return}if(playing&&e.key.toLowerCase()==='x'){cycleWeaponMode();e.preventDefault();return}setKey(e,true)});window.addEventListener('keyup',e=>setKey(e,false));
document.querySelectorAll('[data-preview-plane]').forEach(b=>b.addEventListener('click',()=>setCatalogSpecs(b.dataset.previewPlane)));$('#weaponSelect').addEventListener('click',cycleWeaponMode);$('#engineToggle').addEventListener('click',togglePlayerEngine);$('#openHangar').addEventListener('click',()=>showMenuScreen('hangar'));$('#openResearch').addEventListener('click',()=>showMenuScreen('research'));$('#hangarHome').addEventListener('click',()=>showMenuScreen('menu'));$('#researchHome').addEventListener('click',()=>showMenuScreen('menu'));$('#hangarSortie').addEventListener('click',()=>showMenuScreen('modeSelect'));$('#openEncyclopedia').addEventListener('click',openCatalog);$('#closeEncyclopedia').addEventListener('click',closeCatalog);$('#useCatalogPlane').addEventListener('click',()=>{setSelectedAircraft(previewType);showMenuScreen('menu')});document.querySelectorAll('[data-nation-filter]').forEach(b=>b.addEventListener('click',()=>{researchNation=b.dataset.nationFilter;renderResearch()}));$('#start').addEventListener('click',()=>showMenuScreen('modeSelect'));$('#modeHome').addEventListener('click',()=>showMenuScreen('menu'));$('#chooseAIBattle').addEventListener('click',prepareAirspaceBattle);$('#spectatePrevious').addEventListener('click',()=>cycleAirspaceSpectator(-1));$('#spectateNext').addEventListener('click',()=>cycleAirspaceSpectator(1));$('#chooseCampaign').addEventListener('click',()=>showMenuScreen('campaignBriefing'));$('#campaignBack').addEventListener('click',()=>showMenuScreen('modeSelect'));$('#beginCampaign').addEventListener('click',prepareCampaignBattle);$('#again').addEventListener('click',()=>battlePaused&&!ended?resumeBattle():gameMode==='campaign'?prepareCampaignBattle():gameMode==='airspace'?prepareAirspaceBattle():reset());$('#returnHome').addEventListener('click',()=>showMenuScreen('menu'));window.showPause=()=>{
 if(!$('#settings').classList.contains('hidden')){showMenuScreen('menu');return}
 if(playing){battlePaused=true;pausedEngineRunning=player.userData.engineRunning!==false;playing=false;clearFlightInputs();player.userData.engineRunning=false;stopGunSounds();stopEngineSound();$('#again').textContent='继续战斗　→';$('#end').classList.remove('hidden');$('#resultTitle').textContent='任务暂停';$('#resultCopy').textContent='点击继续战斗返回当前空战。'}
 else if(ended)reset()
};
$('#openSettings').addEventListener('click',()=>showMenuScreen('settings'));
$('#settingsHome').addEventListener('click',()=>showMenuScreen('menu'));
document.querySelectorAll('[name="flightControlMode"]').forEach(input=>input.addEventListener('change',()=>{if(input.checked)changeControlMode(input.value)}));
$('#cursorSensitivity').addEventListener('input',event=>{controlSettings.sensitivity=THREE.MathUtils.clamp(Number(event.target.value)||1,.5,1.8);saveControlSettings();renderControlSettings()});
window.addEventListener('blur',clearFlightInputs);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing)window.showPause();else clearFlightInputs()});
window.addEventListener('resize',clearFlightInputs);
renderControlSettings();

prepareGameAudio();
window.addEventListener('pointerdown',resumeGameAudio,{passive:true});
window.addEventListener('keydown',resumeGameAudio,{passive:true});
window.addEventListener('pointerup',stopPendingGunSounds,{passive:true});
window.addEventListener('pointercancel',stopPendingGunSounds,{passive:true});
window.addEventListener('keyup',stopPendingGunSounds,{passive:true});
loadProgressionProfile();init();renderHangar();showMenuScreen('menu');


function limitedPitchRate(data,rate){
 const limit=verticalTurnRateForPlane(data.type)*flightControlAuthority(data),aoa=data.aoa||0;
 rate=THREE.MathUtils.clamp(rate,-limit*FLIGHT_PHYSICS.negativePitchFraction,limit);
 if(aoa*rate>0)rate*=THREE.MathUtils.clamp((FLIGHT_PHYSICS.aoaLimit-Math.abs(aoa))/(FLIGHT_PHYSICS.aoaLimit-FLIGHT_PHYSICS.aoaSoft),0,1);
 return rate
}

function instructorDirection(root,direction,dt){
 const data=root.userData,speed=Math.max(data.airspeed||0,1),travel=data.velocity.clone().normalize(),forward=new THREE.Vector3(0,0,-1).applyQuaternion(root.quaternion),target=direction.clone().normalize();
 const unsafe=Math.abs(data.aoa||0)>.30||forward.dot(travel)<.80;
 data.instructorUnsafeSeconds=unsafe?(data.instructorUnsafeSeconds||0)+dt:Math.max(0,(data.instructorUnsafeSeconds||0)-dt*2);
 if(unsafe&&(data.instructorUnsafeSeconds>.12||forward.dot(travel)<0))data.instructorRecovering=true;
 if(data.instructorRecovering&&Math.abs(data.aoa||0)<.14&&forward.dot(travel)>.97)data.instructorRecovering=false;
 if(data.instructorRecovering&&travel.lengthSq()>.1)return travel;
 data.instructorEnergyGuard=false;
 if(target.y>0){
  const energy=THREE.MathUtils.smoothstep(speed,data.minFlightSpeedMps*1.08,data.minFlightSpeedMps*1.65),sustained=Math.min(.5,data.bestClimbMps*Math.max(data.throttle,.25)/speed);
  const allowed=THREE.MathUtils.lerp(sustained,Math.sin(Math.PI*5/12),energy);
  if(target.y>allowed){const flat=target.clone().setY(0).normalize();target.copy(flat.multiplyScalar(Math.sqrt(1-allowed*allowed))).setY(allowed);data.instructorEnergyGuard=true}
 }
 return target
}

function integrateAircraftFlight(aircraft,dt){
 const data=aircraft.userData,velocity=data.velocity,forward=new THREE.Vector3(0,0,-1).applyQuaternion(aircraft.quaternion).normalize(),up=new THREE.Vector3(0,1,0).applyQuaternion(aircraft.quaternion).normalize(),right=new THREE.Vector3(1,0,0).applyQuaternion(aircraft.quaternion).normalize();
 const velocityMps=velocity.clone().multiplyScalar(METERS_PER_UNIT);let speed=velocityMps.length();
 const throttle=THREE.MathUtils.clamp(data.throttle,0,1),along=Math.max(0,velocityMps.dot(forward)),propSpec=PROPELLER_SPECS[data.type],enginePower=propSpec&&Number.isFinite(data.propRpm)?THREE.MathUtils.clamp(data.propRpm/propSpec.maxRpm,0,1):1;
 // Excess power is continuous; bestClimb never overwrites a velocity component.
 const powerLimit=.018*speed+9.81*data.bestClimbMps*Math.max(throttle,.05)/Math.max(speed,data.minFlightSpeedMps*.75);
 const thrust=data.engineRunning!==false?THREE.MathUtils.clamp((data.maxSpeedMps*throttle-along)*.85+(AIRCRAFT_SPECS[data.type].levelDragCompensation||0)*along,0,Math.min(18,powerLimit))*enginePower:0;
 velocity.addScaledVector(forward,thrust/METERS_PER_UNIT*dt);velocityMps.copy(velocity).multiplyScalar(METERS_PER_UNIT);speed=velocityMps.length();
 const travel=speed>.01?velocityMps.clone().divideScalar(speed):forward.clone(),aoa=Math.atan2(-velocityMps.dot(up),Math.max(velocityMps.dot(forward),.01)),absAoA=Math.abs(aoa),lowLift=THREE.MathUtils.clamp(speed/data.minFlightSpeedMps,0,1),stall=THREE.MathUtils.smoothstep(absAoA,.20,.56),turnLimit=turnRateForPlane(data.type,speed),verticalLimit=verticalTurnRateForPlane(data.type),horizontalLimit=speed*turnLimit;
 const liftAxis=up.clone().addScaledVector(travel,-up.dot(travel));if(liftAxis.lengthSq()>.00001)liftAxis.normalize();else liftAxis.copy(up);
 const upright=Math.max(0,liftAxis.y),trimLoad=upright>0?1/Math.max(upright,.10):1;
 const maxLift=9.81+speed*Math.max(turnLimit,verticalLimit),minLift=-speed*verticalLimit*FLIGHT_PHYSICS.negativePitchFraction;
 const lift=THREE.MathUtils.clamp((9.81*Math.max(0,1-travel.y*travel.y)*trimLoad+speed*FLIGHT_PHYSICS.liftResponse*aoa)*lowLift*lowLift*(1-.76*stall),minLift,maxLift);
 const acceleration=liftAxis.multiplyScalar(lift),slip=THREE.MathUtils.clamp(velocityMps.dot(right)/Math.max(speed,.01),-1,1),slipAxis=right.clone().addScaledVector(travel,-right.dot(travel));
 let slipAssist=0;
 if(slipAxis.lengthSq()>.00001){
  slipAssist=Math.min(Math.abs(velocityMps.dot(right))*1.8,horizontalLimit*((data.ai||data.flightAssist)? .5:.3))*lowLift*(1-stall*.7);
  acceleration.addScaledVector(slipAxis.normalize(),-Math.sign(slip)*slipAssist)
 }
 const horizontal=Math.hypot(acceleration.x,acceleration.z);if(horizontal>horizontalLimit&&horizontal>0){acceleration.x*=horizontalLimit/horizontal;acceleration.z*=horizontalLimit/horizontal}
 velocity.addScaledVector(acceleration,dt/METERS_PER_UNIT);velocity.y-=9.81/METERS_PER_UNIT*dt;
 // Aerodynamic yaw aligns the body's lateral axis gradually; no velocity snap or
 // duplicate world-yaw rotation is added on top of the instructor's local pull.
 const yawRate=THREE.MathUtils.clamp(-Math.asin(slip)*6,-turnLimit,turnLimit)*lowLift;
 rotateAircraftLocal(aircraft,new THREE.Vector3(0,1,0),yawRate*dt);
 const overspeed=Math.max(0,velocity.length()*METERS_PER_UNIT/data.maxSpeedMps-1),turnLoad=THREE.MathUtils.clamp(horizontal/9.81,0,2.4),drag=.018+Math.min(absAoA,.55)**2*.22+Math.min(Math.abs(slip),.7)**2*.16+stall*.10+overspeed*overspeed*2+.002*turnLoad*turnLoad+(AIRCRAFT_SPECS[data.type].highSpeedTurnDrag||0)*turnLoad*turnLoad*THREE.MathUtils.smoothstep(speed,data.maxSpeedMps*.75,data.maxSpeedMps);
 velocity.multiplyScalar(Math.exp(-drag*dt));aircraft.position.addScaledVector(velocity,dt);
 data.aoa=aoa;data.sideslip=Math.asin(slip);data.slipAssistAcceleration=slipAssist;data.turnRate=THREE.MathUtils.clamp(travel.clone().cross(acceleration).y/Math.max(speed,.01),-turnLimit,turnLimit);data.airspeed=velocity.length()*METERS_PER_UNIT;
 return data.airspeed
}

function cursorChaseQuaternion(){
 const nose=new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion),angle=nose.angleTo(cursorDirectionWorld),turn=new THREE.Quaternion().setFromUnitVectors(nose,cursorDirectionWorld);
 const blend=Math.min(.75,THREE.MathUtils.degToRad(55)/Math.max(angle,.001)),view=nose.applyQuaternion(new THREE.Quaternion().slerp(turn,blend)).normalize();
 const flat=view.clone().setY(0);if(flat.lengthSq()<.000001)flat.copy(cursorDirectionWorld).setY(0);flat.normalize();
 const heading=Math.atan2(-flat.x,-flat.z),pitch=Math.asin(THREE.MathUtils.clamp(view.y,-1,1));
 return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),heading).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),pitch))
}

function terrainBattleBounds(){
 if(gameMode==='airspace'){const half=6000/(2*METERS_PER_UNIT);return{minX:-half,maxX:half,minZ:-half,maxZ:half}}

 if(activeMapId==='korea1951'&&koreaTerrainBounds)return koreaTerrainBounds;
 const half=MAP_LIBRARY[activeMapId].sizeMeters/(2*METERS_PER_UNIT);return{minX:-half,maxX:half,minZ:-half,maxZ:half}
}

function outsideTerrainMeters(position){
 const b=terrainBattleBounds(),x=position.x-THREE.MathUtils.clamp(position.x,b.minX,b.maxX),z=position.z-THREE.MathUtils.clamp(position.z,b.minZ,b.maxZ);
 return Math.hypot(x,z)*METERS_PER_UNIT
}

function duelBoundaryReturnGoal(root){
 if(gameMode!=='duel'&&gameMode!=='airspace')return null;
 const data=root.userData,b=terrainBattleBounds(),speed=Math.max(data.airspeed,1),turn=turnRateForPlane(data.type,speed),radius=speed/Math.max(turn,.025),buffer=Math.min(radius*1.35+speed*.7+120,Math.min(b.maxX-b.minX,b.maxZ-b.minZ)*METERS_PER_UNIT*.43)/METERS_PER_UNIT;
 const v=data.velocity,sideTimes=[],marginUnits=DUEL_BOUNDARY_RULES.aiMarginMeters/METERS_PER_UNIT;
 if(v.x>0)sideTimes.push((b.maxX+marginUnits-root.position.x)/v.x);else if(v.x<0)sideTimes.push((b.minX-marginUnits-root.position.x)/v.x);
 if(v.z>0)sideTimes.push((b.maxZ+marginUnits-root.position.z)/v.z);else if(v.z<0)sideTimes.push((b.minZ-marginUnits-root.position.z)/v.z);
 const margin=Math.min(root.position.x-b.minX,b.maxX-root.position.x,root.position.z-b.minZ,b.maxZ-root.position.z),danger=outsideTerrainMeters(root.position)>0||(sideTimes.length&&Math.min(...sideTimes)<buffer*METERS_PER_UNIT/speed);
 if(danger)data.boundaryReturning=true;
 if(data.boundaryReturning&&margin>buffer*.8&&Math.min(...sideTimes)>buffer*METERS_PER_UNIT/speed*1.2)data.boundaryReturning=false;
 if(!data.boundaryReturning)return null;
 return new THREE.Vector3((b.minX+b.maxX)*.5,Math.max(root.position.y,terrainHeightAt(root.position.x,root.position.z)+AI_TACTICS.groundClearanceMeters/METERS_PER_UNIT),(b.minZ+b.maxZ)*.5)
}

function enforceDuelAIBoundary(root){
 if((gameMode!=='duel'&&gameMode!=='airspace')||!root)return;
 const b=terrainBattleBounds(),nearest=new THREE.Vector3(THREE.MathUtils.clamp(root.position.x,b.minX,b.maxX),root.position.y,THREE.MathUtils.clamp(root.position.z,b.minZ,b.maxZ)),delta=root.position.clone().sub(nearest),length=delta.length(),limit=DUEL_BOUNDARY_RULES.aiMarginMeters/METERS_PER_UNIT;
 if(length<=limit)return;
 const normal=delta.divideScalar(length);root.position.copy(nearest.addScaledVector(normal,limit));
 const outward=root.userData.velocity.dot(normal);if(outward>0)root.userData.velocity.addScaledVector(normal,-outward);
 root.userData.airspeed=root.userData.velocity.length()*METERS_PER_UNIT;root.userData.boundaryReturning=true
}

function resetDuelBoundary(){
 duelDesertionRemaining=null;$('#boundaryWarning').classList.add('hidden')
}

function updateDuelBoundary(elapsed){
 if(gameMode==='airspace'){if(!playing||!airspacePlayerAlive()){resetDuelBoundary();return}}

 if((gameMode!=='duel'&&gameMode!=='airspace')||!playing||!player){if(gameMode!=='duel'&&gameMode!=='airspace')resetDuelBoundary();return}
 if(gameMode==='duel')enforceDuelAIBoundary(enemy);
 if(outsideTerrainMeters(player.position)<=DUEL_BOUNDARY_RULES.playerMarginMeters){
  const returning=duelDesertionRemaining!==null;resetDuelBoundary();if(returning)toast('已返回战区，自毁倒计时取消');return
 }
 if(duelDesertionRemaining===null)duelDesertionRemaining=DUEL_BOUNDARY_RULES.desertionSeconds;
 duelDesertionRemaining=Math.max(0,duelDesertionRemaining-Math.max(0,elapsed));
 const warning=$('#boundaryWarning');warning.classList.remove('hidden');warning.textContent='临阵脱逃，自毁倒计时：'+Math.ceil(duelDesertionRemaining)+'秒';
 if(duelDesertionRemaining<=.000001){
  if(gameMode==='airspace'){player.userData.desertionDestroyed=true;damageAirspaceUnit(airspaceUnitFor(player),airspaceUnitFor(player).health);toast('越界超过15秒 · 战机自毁，进入观战');return}
  hp=0;player.userData.desertionDestroyed=true;updateHealthUI();finish(false);$('#resultTitle').textContent='临阵脱逃';$('#resultCopy').textContent='越界超过15秒，战机已执行强制自毁。'
 }
}
