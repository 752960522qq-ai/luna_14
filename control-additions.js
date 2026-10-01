// v10: persistent flight controls; the direction ring commands the instructor,
// while the real gunsight and lead indicator follow the existing projectile model.
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
  :'左右移动摇杆进行滚转；向下拉杆抬头，向上推杆俯冲。松手停止操纵，拖动空白区域可自由观察。';
 applyControlModeUI()
}
function applyControlModeUI(){
 const isCursor=controlSettings.mode==='cursor';
 $('#joystick').classList.toggle('hidden',isCursor);
 $('#freeLook').classList.toggle('hidden',!isCursor);
 $('#cursorStatus').classList.toggle('hidden',!isCursor);
 if(!isCursor){$('#aimCursor').style.display='none';$('#leadIndicator').style.display='none'}
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
 const fov=THREE.MathUtils.degToRad(camera?.fov||63),gain=controlSettings.sensitivity*1.4;
 const yaw=-dx*fov*(width/Math.max(height,1))/Math.max(width,1)*gain;
 const pitch=-dy*fov/Math.max(height,1)*gain,worldUp=new THREE.Vector3(0,1,0);
 cursorDirectionWorld.applyAxisAngle(worldUp,yaw);
 const right=new THREE.Vector3().crossVectors(cursorDirectionWorld,worldUp).normalize();
 if(right.lengthSq()>.0001)cursorDirectionWorld.applyAxisAngle(right,pitch);
 const elevation=THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(cursorDirectionWorld.y,-1,1)),-Math.PI*5/12,Math.PI*5/12);
 const flat=cursorDirectionWorld.clone().setY(0);
 if(flat.lengthSq()<1e-8)flat.set(0,0,-1);flat.normalize();
 cursorDirectionWorld.copy(flat.multiplyScalar(Math.cos(elevation))).setY(Math.sin(elevation)).normalize()
}
function updateCursorFlightControls(dt){
 const horizontal=(keys.right?1:0)-(keys.left?1:0),vertical=(keys.down?1:0)-(keys.up?1:0);
 if(horizontal||vertical)moveCursorDirection(horizontal*innerHeight*.55*dt,vertical*innerHeight*.55*dt);
 player.userData.flightAssist=true;
 steerAircraftToward(player,cursorDirectionWorld,dt);
 return advanceAircraft(player,dt)
}
function cursorViewQuaternion(){
 const heading=Math.atan2(-cursorDirectionWorld.x,-cursorDirectionWorld.z),pitch=Math.asin(THREE.MathUtils.clamp(cursorDirectionWorld.y,-1,1));
 return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),heading)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),pitch))
}
function availableCursorTargets(){
 return gameMode==='campaign'?campaignTargets().filter(t=>t.health>0).map(t=>t.root):(enemy&&eHp>0?[enemy]:[])
}
function updateCursorTarget(dt){
 if(controlSettings.mode!=='cursor'||!playing){cursorTarget=null;return}
 const targets=availableCursorTargets();
 if(cursorTarget&&!targets.includes(cursorTarget))cursorTarget=null;
 if(keys.look)return;
 let candidate=null,bestAngle=.065;
 for(const root of targets){
  const relative=root.position.clone().sub(player.position),distance=relative.length()*METERS_PER_UNIT;
  if(distance<20||distance>3500)continue;
  const angle=Math.acos(THREE.MathUtils.clamp(relative.normalize().dot(cursorDirectionWorld),-1,1));
  if(angle<bestAngle){bestAngle=angle;candidate=root}
 }
 if(candidate!==cursorCandidate){cursorCandidate=candidate;cursorCandidateSeconds=0}
 if(candidate){cursorCandidateSeconds+=dt;if(cursorCandidateSeconds>=.3){cursorTarget=candidate;cursorOutsideSeconds=0}}
 if(cursorTarget){
  const relative=cursorTarget.position.clone().sub(player.position);
  const outside=relative.length()*METERS_PER_UNIT>4000||relative.normalize().dot(cursorDirectionWorld)<Math.cos(.4);
  cursorOutsideSeconds=outside?cursorOutsideSeconds+dt:0;
  if(cursorOutsideSeconds>.45){cursorTarget=null;cursorOutsideSeconds=0}
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
 if(!player||!camera)return;
 const isCursor=controlSettings.mode==='cursor',gun=playerGunReference(),forward=new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion).normalize();
 const origin=gun?.origin||player.position,reticle=$('#reticle');
 if(gun)placeFlightMarker(reticle,origin.clone().addScaledVector(forward,100));else reticle.style.display='none';
 const ring=$('#aimCursor'),lead=$('#leadIndicator');
 if(!isCursor){ring.style.display='none';lead.style.display='none';return}
 placeFlightMarker(ring,player.position.clone().addScaledVector(cursorDirectionWorld,120),true);
 lead.style.display='none';const status=$('#cursorStatus');
 if(!gun){status.textContent='方向环飞行 · 炮塔自动防御';return}
 if(!cursorTarget){status.textContent='方向环操控 · 指向敌机可锁定';return}
 const targetName=planeInfo[cursorTarget.userData.type]?.name||'敌机';
 const solution=solveBulletIntercept(gun.origin,cursorTarget.position,cursorTarget.userData.velocity,gun.spec.speed/METERS_PER_UNIT);
 if(!solution){status.textContent=targetName+' · 超出有效弹道';return}
 const aimPoint=gun.origin.clone().addScaledVector(solution.direction,100);
 placeFlightMarker(lead,aimPoint);
 const angle=Math.acos(THREE.MathUtils.clamp(solution.direction.dot(forward),-1,1));
 lead.classList.toggle('aligned',angle<.015);
 const gunNames={n37:'N-37',ns23:'NS-23',m2:'12.7 mm',mg762:'7.62 mm',hispano:'20 mm',mg:'机枪'};
 status.textContent=targetName+' · '+(gunNames[gun.id]||'主武器')+'提前量'+(angle<.015?' · 准星已对齐':'')
}
function resumeBattle(){
 if(!battlePaused||ended)return;
 clearFlightInputs();battlePaused=false;playing=true;player.userData.engineRunning=pausedEngineRunning;
 $('#end').classList.add('hidden');$('#again').textContent='再次升空　→';
 startEngineSound(playerPlane);clock.getDelta();toast('继续战斗')
}
