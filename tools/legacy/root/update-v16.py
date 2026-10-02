"""Generate v16 from the exact, delivered v15 page; inputs stay reproducible."""
from pathlib import Path
import hashlib,re
root=Path(__file__).resolve().parent
base=root/'baseline/v15-index.html'
assert hashlib.sha256(base.read_bytes()).hexdigest()=='aa4f7e3e0c0a1ecdfecdb3ea782282af655cc46fc6c867f65b81c1d4541228b5'
before,rest=base.read_text().split('<script type="module">',1)
module,after=rest.split('</script>',1)
def replace_once(old,new):
    global module
    assert module.count(old)==1,(old,module.count(old))
    module=module.replace(old,new,1)
def function_text(name):
    start=module.index('function '+name+'(')
    arg=module.index('(',start);depth=1
    while depth:
        arg+=1;depth+=(module[arg]=='(')-(module[arg]==')')
    end=module.index('{',arg);depth=1
    while depth:
        end+=1;depth+=(module[end]=='{')-(module[end]=='}')
    return module[start:end+1]
def replace_function(name,new):replace_once(function_text(name),new)

replace_once('const AIRCRAFT_SPECS={',"const AIRCRAFT_SPECS={i15:{modelFile:'./i15-soviet.glb',lengthMeters:6.10,chaseOffsetMeters:2,chaseHeightMeters:2,levelDragCompensation:.018,rollRateDps:165,control:{stickAttackSeconds:.045,stickReleaseSeconds:.065,rollResponse:12,rollRelease:13,pitchResponse:8},axisFlip:[1,1,1],collisionMeters:{x:9.58293027,y:3.29077148,z:6.10}},")
for length in ['10.10','11.4','12.6']:
    replace_once('lengthMeters:'+length+',chaseOffsetMeters:1,','lengthMeters:'+length+',chaseOffsetMeters:.5,chaseHeightMeters:2,')
replace_once('lengthMeters:30.18,chaseOffsetMeters:1,','lengthMeters:30.18,chaseOffsetMeters:1,chaseHeightMeters:2,')
replace_once('const PROPELLER_SPECS={',"const PROPELLER_SPECS={i15:{idleRpm:550,maxRpm:1900,direction:1,spoolUpSeconds:2.7,spoolDownSeconds:3.5,blurStartRpm:750,blurFullRpm:1200,radius:1.324},")
replace_once('const AIRCRAFT_TREE={',"const AIRCRAFT_TREE={i15:{nation:'ussr',nationName:'苏系',rating:1.0,rank:'I',branch:'双翼战斗机'},")
module=module.replace("'bf109b1','p36a','f3f2','mig3']","'bf109b1','p36a','f3f2','mig3','i15']")
replace_once("name:'苏系 · 苏联',types:['mig3','mig15']","name:'苏系 · 苏联',types:['i15','mig3','mig15']")
replace_once('const planeInfo={',"""const planeInfo={i15:{name:'I-15',health:340,maxSpeedKmh:365,minLevelFlightKmh:105,bestClimbMps:12.7,turnTimeS:13.8,horizontalTurnRateDps:360/13.8,verticalTurnTimeS:8.6,verticalTurnRateDps:360/8.6,turnRadiusM:130,intro:'经典海鸥翼双翼战斗机，拥有极强的水平缠斗能力，回转极为灵活；采用固定起落架，极速不高，高空性能弱，适合低空低速狗斗，不适合高速俯冲交战，西班牙内战大量使用。',specs:[['系别','苏联'],['等级','I'],['战机权重','1.0'],['机体耐久','340'],['最大航速','365 km/h'],['最小航速','105 km/h'],['最佳爬升率','12.7 m/s'],['水平转弯性能','13.8秒'],['垂直转弯性能','8.6秒'],['7.62mm PV-1航空机枪','4挺 · 总备弹3200发 · 单管750发/分钟 · 伤害13 · 弹速775 m/s']]},""")
replace_once("name:'Meteor F.4 G.41G 流星 F4 短翼型'","name:'Meteor F Mk 4 G.41G'")
replace_once('const weaponInfo={',"const weaponInfo={i15:{mg:{rpm:750,damage:13,speed:775,cost:4,count:4,radius:.07,color:0xffdf96,offsets:[[-.032,.026,-.235],[-.032,-.014,-.235],[.032,.026,-.235],[.032,-.014,-.235]]}},")
replace_once('const AI_FIGHTER={',"const AI_FIGHTER={i15:{detectMeters:2350,loseMeters:2850,alignMeters:600,breakMeters:100,passSeconds:2.7,gun:{mg:{rangeMeters:500,coneDeg:6.5}}},")
replace_once('const AI_TACTICS={decisionSeconds:.15,','const AI_TACTICS={maxAltitudeMeters:3000,decisionSeconds:.15,')
replace_once('new THREE.PerspectiveCamera(63,innerWidth/innerHeight,.1,1400)','new THREE.PerspectiveCamera(63,innerWidth/innerHeight,.02,1400)')
replace_once('function freshAmmo(type){',"function freshAmmo(type){if(type==='i15')return{mg:3200,m2:0,mg762:0,n37:0,ns23:0,hispano:0};")
replace_once('function updateAmmoUI(){',"function updateAmmoUI(){if(playerPlane==='i15'){$('#ammo').textContent=`PV-1 ${playerAmmo.mg} / 3200`;$('#ammoBar').style.width=(playerAmmo.mg/3200*100)+'%'}else ")
replace_once('function gunSoundFor(type,id){',"function gunSoundFor(type,id){if(type==='i15')return'pv1Gun';")
replace_once("const scaled=['p36a','f3f2','mig3'].includes(type)","const scaled=['i15','p36a','f3f2','mig3'].includes(type)")
module=module.replace("type==='f3f2'||type==='mig3'", "type==='i15'||type==='f3f2'||type==='mig3'")
replace_once("if(type==='p36a'){pivot=source.getObjectByName('prop_49');blades=pivot?.children.filter(node=>node.isMesh)||[]}","""if(type==='p36a'){pivot=source.getObjectByName('prop_49');blades=pivot?.children.filter(node=>node.isMesh)||[]}
 if(type==='i15'){
  const authored=source.getObjectByName('prop01_1');if(!authored)throw new Error('缺少 I-15 螺旋桨');
  const center=new THREE.Box3().setFromObject(authored).getCenter(new THREE.Vector3());authored.parent.worldToLocal(center);
  pivot=new THREE.Group();pivot.name='PropellerPivot';pivot.position.copy(center);authored.parent.add(pivot);pivot.attach(authored);blades=[authored]
 }""")
replace_once("root.userData={modelContext:options.preview?'preview':'combat',type,", "root.userData={isPlayer,modelContext:options.preview?'preview':'combat',type,")
old=function_text('advanceAircraft')
replace_function('advanceAircraft',old.replace('for(let i=0;i<count;i++)integrateAircraftFlight(aircraft,step);','for(let i=0;i<count;i++){integrateAircraftFlight(aircraft,step);enforceAICeiling(aircraft)}'))
replace_once('target=instructorDirection(aircraft,targetDirection,dt),','target=limitAICeilingDirection(aircraft,instructorDirection(aircraft,targetDirection,dt)),')
old=function_text('safeAIGoal');replace_function('safeAIGoal',old.replace(' return safe',' safe.y=Math.min(safe.y,AI_TACTICS.maxAltitudeMeters/METERS_PER_UNIT-90-5);\n return safe'))
replace_once("if(!isPlayer)scene.add(root);makeAirspaceUnit(team,index,type,root);","if(!isPlayer){enforceAICeiling(root);scene.add(root)}makeAirspaceUnit(team,index,type,root);")
old=function_text('rememberAircraftFrameStart')
replace_function('rememberAircraftFrameStart',old.replace('(root.userData.frameStartPosition??=new THREE.Vector3()).copy(root.position)',"(root.userData.frameStartPosition??=new THREE.Vector3()).copy(root.position);(root.userData.renderPreviousPosition??=new THREE.Vector3()).copy(root.position);(root.userData.renderPreviousQuaternion??=new THREE.Quaternion()).copy(root.quaternion)"))
old=function_text('updateChaseCamera')
old=old.replace(' if(!player||!camera)return;',' if(!player||!camera)return;followCameraAnchor(player);')
old=old.replace('const chaseHeight=AIRCRAFT_SPECS[playerPlane].chaseOffsetMeters!==undefined?AIRCRAFT_SPECS[playerPlane].chaseOffsetMeters/METERS_PER_UNIT:', 'const chaseHeight=Number.isFinite(AIRCRAFT_SPECS[playerPlane].chaseHeightMeters)?AIRCRAFT_SPECS[playerPlane].chaseHeightMeters/METERS_PER_UNIT:AIRCRAFT_SPECS[playerPlane].chaseOffsetMeters!==undefined?AIRCRAFT_SPECS[playerPlane].chaseOffsetMeters/METERS_PER_UNIT:')
replace_function('updateChaseCamera',old)
old=function_text('updateAirspaceSpectatorCamera');replace_function('updateAirspaceSpectatorCamera',old.replace('function updateAirspaceSpectatorCamera(root,dt){','function updateAirspaceSpectatorCamera(root,dt){\n followCameraAnchor(root);'))
replace_once('function resetCameraTracking(){','function resetCameraTracking(){cameraTrackedRoot=null;')
old=function_text('reset');old=old.replace('function reset(){','function reset(options={}){battleSimulationAccumulator=0;battleHudElapsed=Infinity;')
old=old.replace('ended=false;playing=true;startEngineSound(playerPlane);','ended=false;playing=!options.preparing;if(playing)startEngineSound(playerPlane);')
replace_function('reset',old)
old=function_text('prepareAirspaceBattle')
old=old.replace("button.disabled=true;$('#airspaceLoadStatus')", "button.disabled=true;setBattleLoading(true,'正在准备空域与编队…');$('#airspaceLoadStatus')")
old=old.replace('...duelOpponentsFor(selectedAircraft).map(loadPlaneModel)', '...duelOpponentsFor(selectedAircraft).map(loadPlaneModel),...audioLoads.values()')
old=old.replace("gameMode='airspace';reset();", "gameMode='airspace';reset({preparing:true});await warmBattleRenderer();if(token!==airspacePrepareToken)return;playing=true;airspaceAccumulator=0;battleHudElapsed=Infinity;clock.getDelta();startEngineSound(playerPlane);setBattleLoading(false);")
old=old.replace("button.disabled=false;if(playing)","button.disabled=false;setBattleLoading(false);if(playing)")
replace_function('prepareAirspaceBattle',old)
replace_once("$('#beginCampaign').addEventListener('click',()=>{gameMode='campaign';reset()})","$('#beginCampaign').addEventListener('click',prepareCampaignBattle)")
replace_once("battlePaused&&!ended?resumeBattle():reset()", "battlePaused&&!ended?resumeBattle():gameMode==='campaign'?prepareCampaignBattle():gameMode==='airspace'?prepareAirspaceBattle():reset()")
replace_once("airspacePrepareToken++;$('#chooseAIBattle').disabled=false;", "airspacePrepareToken++;setBattleLoading(false);$('#beginCampaign').disabled=false;$('#chooseAIBattle').disabled=false;")
replace_once("if(!bulletResources[resourceId])bulletResources[resourceId]={geometry:new THREE.SphereGeometry(spec.radius/METERS_PER_UNIT,8,8),material:new THREE.MeshBasicMaterial({color:spec.color})};\n   const resource=bulletResources[resourceId];", "const resource=ensureBulletResources(type,id);")
old=function_text('updateAirspaceFrame')
start=old.index(' if(playing){');end=old.index(' const view=')
old=old[:start]+' if(elapsed>0)advanceAirspaceSimulation(elapsed);\n const hudDue=shouldUpdateBattleHUD(dt);\n'+old[end:]
old=old.replace('if(playing)updateAirspaceTacticalDisplay();updateAirspaceHUD();','if(playing&&hudDue)updateAirspaceTacticalDisplay();if(hudDue)updateAirspaceHUD();')
old=old.replace(' if(view){',' if(view&&hudDue){').replace('updateEngineAudio();updateAmmoUI();updateHealthUI();updateEngineUI()','updateEngineAudio();if(hudDue){updateAmmoUI();updateHealthUI();updateEngineUI()}')
replace_function('updateAirspaceFrame',old)
old=function_text('updateCampaign')
replace_function('updateCampaign',old.replace('updateCampaignHud();if(campaignTimeRemaining<=0)','if(campaignTimeRemaining<=0)'))

old=function_text('animate')
start=old.index('  rememberAircraftFrameStart();');end=old.index('  updateChaseCamera(dt);')
step=old[start:end].replace('updateDuelBoundary(elapsed)','updateDuelBoundary(dt)')
step=step.replace('rememberAircraftFrameStart();updatePlayerFlightControls(dt);','worldTime+=dt;rememberAircraftFrameStart();updateAllPropellers(dt);updatePlayerFlightControls(dt);')
step='function updateNonAirspaceStep(dt){\n'+step+'}\n'
new="""function animate(){
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
}"""
replace_function('animate',step+(root/'v16-flight-stability.mjs').read_text()+'\n'+new)

before=before.replace(' · v15',' · v16').replace('当前已开放 9 架机型','当前已开放 10 架机型').replace('id="ownedCount">09','id="ownedCount">10')
before=before.replace('<div class="planes">','<div class="planes"><button class="plane-option" data-preview-plane="i15"><b>I-15</b><span>苏系 1.0 · I级 · 海鸥翼双翼战斗机</span></button>')
before=before.replace('<div class="hud hidden" id="hud">','<div id="battleLoading" class="battle-loading hidden"><b id="battleLoadingText">正在准备战区…</b></div><div class="hud hidden" id="hud">')
css="""
/* Keep telemetry on the upper-right edge and objectives clear of it. */
.hud .top{left:auto;right:4px;top:0;bottom:auto;width:clamp(220px,28vw,320px);justify-content:flex-end;padding:4px 7px;background:#06131ccc;border-radius:0 0 0 8px}
.hud .readout{width:100%;display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,.65fr);gap:6px;text-align:right}
.hud .readout label{font-size:8px;letter-spacing:0;white-space:nowrap}
.hud .readout strong{display:block;font-size:clamp(13px,1.9vw,21px);white-space:nowrap}
#campaignHud,#airspaceHud{left:140px;right:calc(clamp(220px,28vw,320px) + 18px);width:auto;max-width:none;transform:none;top:0}
#airspaceHud{flex-wrap:wrap;gap:3px 6px;padding:5px 6px;font-size:10px}
#airspaceHud .team-score{font-size:9px;white-space:nowrap}
#airspaceHud .team-score strong{font-size:17px;margin:0 3px}
#airspaceHud .a-point-panel{min-width:130px;flex:1 1 130px}
#airspaceHud .a-capture-label{font-size:9px}
#campaignHud{padding:6px;font-size:10px}
.battle-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:60;background:#07111de8;color:#dcf5ff;font-size:18px;pointer-events:auto}
@media(max-width:640px){.hud .top{right:2px;top:0;width:210px;padding:3px 5px}.hud .readout{gap:4px}.hud .readout label{font-size:7px}.hud .readout strong{font-size:13px}#campaignHud,#airspaceHud{left:105px;right:220px;top:0;max-width:none;font-size:8px}#airspaceHud .team-score{font-size:8px}#airspaceHud .team-score strong{font-size:14px}#airspaceHud .a-point-panel{min-width:100px;flex-basis:100px}#airspaceHud .a-capture-label{font-size:8px}}
"""
before=before.replace('</style>',css+'</style>')
(root/'app/src/main/assets/index.html').write_text(before+'<script type="module">'+module+'</script>'+after)
(root/'game.mjs').write_text(module)
p=root/'app/build.gradle';p.write_text(re.sub(r'versionCode \d+','versionCode 16',p.read_text()))
print('Generated v16: I-15, independent chase offsets, telemetry, AI ceiling and fixed simulation/rendering')
