// Shared arcade flight model and instructor. All speeds/forces are SI internally.
const FLIGHT_PHYSICS={stepSeconds:1/120,maxBankRadians:85*Math.PI/180,liftResponse:4.5,aoaSoft:.13,aoaLimit:.26,negativePitchFraction:.75};
const DUEL_BOUNDARY_RULES={aiMarginMeters:100,playerMarginMeters:300,desertionSeconds:15};
let koreaTerrainBounds=null,duelDesertionRemaining=null;

function moveCursorDirection(dx,dy,width=innerWidth,height=innerHeight){
 if(!Number.isFinite(dx)||!Number.isFinite(dy))return;
 const scale=THREE.MathUtils.degToRad(camera?.fov||63)*controlSettings.sensitivity*1.4/Math.max(height,1);
 const heading=Math.atan2(-cursorDirectionWorld.x,-cursorDirectionWorld.z)-dx*scale;
 const elevation=THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(cursorDirectionWorld.y,-1,1))-dy*scale,-Math.PI*5/12,Math.PI*5/12);
 cursorDirectionWorld.set(-Math.sin(heading)*Math.cos(elevation),Math.sin(elevation),-Math.cos(heading)*Math.cos(elevation)).normalize()
}
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
function steerAircraftToward(aircraft,targetDirection,dt){
 const data=aircraft.userData,type=data.type,speed=Math.max(data.airspeed||0,1),authority=flightControlAuthority(data),target=instructorDirection(aircraft,targetDirection,dt),forward=new THREE.Vector3(0,0,-1).applyQuaternion(aircraft.quaternion),travel=data.velocity.clone().normalize(),targetFlat=target.clone().setY(0),travelFlat=travel.clone().setY(0),turnLimit=turnRateForPlane(type,speed);
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
function integrateAircraftFlight(aircraft,dt){
 const data=aircraft.userData,velocity=data.velocity,forward=new THREE.Vector3(0,0,-1).applyQuaternion(aircraft.quaternion).normalize(),up=new THREE.Vector3(0,1,0).applyQuaternion(aircraft.quaternion).normalize(),right=new THREE.Vector3(1,0,0).applyQuaternion(aircraft.quaternion).normalize();
 const velocityMps=velocity.clone().multiplyScalar(METERS_PER_UNIT);let speed=velocityMps.length();
 const throttle=THREE.MathUtils.clamp(data.throttle,0,1),along=Math.max(0,velocityMps.dot(forward)),propSpec=PROPELLER_SPECS[data.type],enginePower=propSpec&&Number.isFinite(data.propRpm)?THREE.MathUtils.clamp(data.propRpm/propSpec.maxRpm,0,1):1;
 // Excess power is continuous; bestClimb never overwrites a velocity component.
 const powerLimit=.018*speed+9.81*data.bestClimbMps*Math.max(throttle,.05)/Math.max(speed,data.minFlightSpeedMps*.75);
 const thrust=data.engineRunning!==false?THREE.MathUtils.clamp((data.maxSpeedMps*throttle-along)*.85,0,Math.min(18,powerLimit))*enginePower:0;
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
 const overspeed=Math.max(0,velocity.length()*METERS_PER_UNIT/data.maxSpeedMps-1),turnLoad=THREE.MathUtils.clamp(horizontal/9.81,0,2.4),drag=.018+Math.min(absAoA,.55)**2*.22+Math.min(Math.abs(slip),.7)**2*.16+stall*.10+overspeed*overspeed*2+.002*turnLoad*turnLoad;
 velocity.multiplyScalar(Math.exp(-drag*dt));aircraft.position.addScaledVector(velocity,dt);
 data.aoa=aoa;data.sideslip=Math.asin(slip);data.slipAssistAcceleration=slipAssist;data.turnRate=THREE.MathUtils.clamp(travel.clone().cross(acceleration).y/Math.max(speed,.01),-turnLimit,turnLimit);data.airspeed=velocity.length()*METERS_PER_UNIT;
 return data.airspeed
}
function advanceAircraft(aircraft,dt){
 const count=Math.max(1,Math.ceil(dt/FLIGHT_PHYSICS.stepSeconds)),step=dt/count;
 for(let i=0;i<count;i++)integrateAircraftFlight(aircraft,step);
 return aircraft.userData.airspeed
}
function updateCursorFlightControls(dt){
 const horizontal=(keys.right?1:0)-(keys.left?1:0),vertical=(keys.down?1:0)-(keys.up?1:0);
 if(horizontal||vertical)moveCursorDirection(horizontal*innerHeight*.55*dt,vertical*innerHeight*.55*dt);
 player.userData.flightAssist=true;
 const count=Math.max(1,Math.ceil(dt/FLIGHT_PHYSICS.stepSeconds)),step=dt/count;
 for(let i=0;i<count;i++){steerAircraftToward(player,cursorDirectionWorld,step);advanceAircraft(player,step)}
 return player.userData.airspeed
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
function recoverAircraftAttitude(root,dt){
 const travel=root.userData.velocity.clone();if(travel.lengthSq()<.001)return;
 steerAircraftToward(root,travel.normalize(),dt)
}
function cursorChaseQuaternion(){
 const nose=new THREE.Vector3(0,0,-1).applyQuaternion(player.quaternion),angle=nose.angleTo(cursorDirectionWorld),turn=new THREE.Quaternion().setFromUnitVectors(nose,cursorDirectionWorld);
 const blend=Math.min(.75,THREE.MathUtils.degToRad(55)/Math.max(angle,.001)),view=nose.applyQuaternion(new THREE.Quaternion().slerp(turn,blend)).normalize();
 const flat=view.clone().setY(0);if(flat.lengthSq()<.000001)flat.copy(cursorDirectionWorld).setY(0);flat.normalize();
 const heading=Math.atan2(-flat.x,-flat.z),pitch=Math.asin(THREE.MathUtils.clamp(view.y,-1,1));
 return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),heading).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),pitch))
}
function updateCursorTarget(dt){
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
function updateFlightAimingHUD(){
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
function terrainBattleBounds(){
 if(activeMapId==='korea1951'&&koreaTerrainBounds)return koreaTerrainBounds;
 const half=MAP_LIBRARY[activeMapId].sizeMeters/(2*METERS_PER_UNIT);return{minX:-half,maxX:half,minZ:-half,maxZ:half}
}
function outsideTerrainMeters(position){
 const b=terrainBattleBounds(),x=position.x-THREE.MathUtils.clamp(position.x,b.minX,b.maxX),z=position.z-THREE.MathUtils.clamp(position.z,b.minZ,b.maxZ);
 return Math.hypot(x,z)*METERS_PER_UNIT
}
function duelBoundaryReturnGoal(root){
 if(gameMode!=='duel')return null;
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
 if(gameMode!=='duel'||!root)return;
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
 if(gameMode!=='duel'||!playing||!player){if(gameMode!=='duel')resetDuelBoundary();return}
 enforceDuelAIBoundary(enemy);
 if(outsideTerrainMeters(player.position)<=DUEL_BOUNDARY_RULES.playerMarginMeters){
  const returning=duelDesertionRemaining!==null;resetDuelBoundary();if(returning)toast('已返回战区，自毁倒计时取消');return
 }
 if(duelDesertionRemaining===null)duelDesertionRemaining=DUEL_BOUNDARY_RULES.desertionSeconds;
 duelDesertionRemaining=Math.max(0,duelDesertionRemaining-Math.max(0,elapsed));
 const warning=$('#boundaryWarning');warning.classList.remove('hidden');warning.textContent='临阵脱逃，自毁倒计时：'+Math.ceil(duelDesertionRemaining)+'秒';
 if(duelDesertionRemaining<=.000001){
  hp=0;player.userData.desertionDestroyed=true;updateHealthUI();finish(false);$('#resultTitle').textContent='临阵脱逃';$('#resultCopy').textContent='越界超过15秒，战机已执行强制自毁。'
 }
}
