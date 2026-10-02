"""Generate v17 from the delivered v16 page and calibrated camera/economy inputs."""
from pathlib import Path
import hashlib,re,json
root=Path(__file__).resolve().parent
base=root/'baseline/v16-index.html'
assert hashlib.sha256(base.read_bytes()).hexdigest()=='9798718c14ba4052e27aa9514699dacae0085a3bed4a1805544b42c035793473'
before,rest=base.read_text().split('<script type="module">',1);module,after=rest.split('</script>',1)
def replace_once(old,new):
 global module
 assert module.count(old)==1,(old,module.count(old));module=module.replace(old,new,1)
def function_text(name):
 start=module.index('function '+name+'(');at=module.index('(',start);depth=1
 while depth:at+=1;depth+=(module[at]=='(')-(module[at]==')')
 end=module.index('{',at);depth=1
 while depth:end+=1;depth+=(module[end]=='{')-(module[end]=='}')
 return module[start:end+1]
def replace_function(name,new):replace_once(function_text(name),new)
replace_once('const AIRCRAFT_SPECS={',"const AIRCRAFT_SPECS={i16:{modelFile:'./i16-type5.glb',lengthMeters:6.00,chaseOffsetMeters:2,chaseHeightMeters:2,levelDragCompensation:.018,rollRateDps:185,control:{stickAttackSeconds:.045,stickReleaseSeconds:.060,rollResponse:13,rollRelease:14,pitchResponse:8},axisFlip:[1,1,1],collisionMeters:{x:9.00644950,y:2.96361132,z:6.00}},")
replace_once('const PROPELLER_SPECS={',"const PROPELLER_SPECS={i16:{idleRpm:550,maxRpm:1900,direction:1,spoolUpSeconds:2.7,spoolDownSeconds:3.5,blurStartRpm:750,blurFullRpm:1200,radius:1.384},")
replace_once('const AIRCRAFT_TREE={',"const AIRCRAFT_TREE={i16:{nation:'ussr',nationName:'苏系',rating:1.3,rank:'I',branch:'单发战斗机'},")
replace_once('const planeInfo={',"""const planeInfo={i16:{name:'I-16 type 5',health:350,maxSpeedKmh:445,minLevelFlightKmh:118,bestClimbMps:13.4,turnTimeS:17.8,horizontalTurnRateDps:360/17.8,verticalTurnTimeS:9.8,verticalTurnRateDps:360/9.8,turnRadiusM:165,intro:'早期量产型伊-16，M-25A发动机，机体比24型更短；滚转性能优异，水平缠斗强；动力弱于后期型号，极速有限，俯冲不能过快，适合中低空作战。',specs:[['系别','苏联'],['等级','I'],['战机权重','1.3'],['机体耐久','350'],['最大航速','445 km/h'],['最小航速','118 km/h'],['最佳爬升率','13.4 m/s'],['水平转弯性能','17.8秒'],['垂直转弯性能','9.8秒'],['7.62mm ShKAS施卡斯机枪','机头2挺 · 合计备弹850发 · 单管1800发/分钟 · 伤害16 · 弹速825 m/s']]},""")
replace_once('const weaponInfo={',"const weaponInfo={i16:{mg:{rpm:1800,damage:16,speed:825,cost:2,count:2,radius:.06,color:0xffdf96,offsets:[[-.018,.027,-.246],[.018,.027,-.246]]}},")
replace_once('const AI_FIGHTER={',"const AI_FIGHTER={i16:{detectMeters:2500,loseMeters:3000,alignMeters:660,breakMeters:110,passSeconds:2.6,gun:{mg:{rangeMeters:540,coneDeg:6.3}}},")
start=module.index("const PROFILE_KEY='sky-duel-profile-v1'");end=module.index('\nconst AIRCRAFT_TREE=',start)
module=module[:start]+"const PROFILE_KEY='sky-duel-profile-v1';let unlockedPlanes=[],selectedAircraft='i15',selectedBombPayload='18x1000',researchNation='all';"+module[end:]
replace_once('function freshAmmo(type){',"function freshAmmo(type){if(type==='i16')return{mg:850,m2:0,mg762:0,n37:0,ns23:0,hispano:0};")
replace_once('function updateAmmoUI(){',"function updateAmmoUI(){if(playerPlane==='i16'){$('#ammo').textContent=`ShKAS ${playerAmmo.mg} / 850`;$('#ammoBar').style.width=(playerAmmo.mg/850*100)+'%'}else ")
replace_once('function gunSoundFor(type,id){',"function gunSoundFor(type,id){if(type==='i16')return'pv1Gun';")
replace_once("if(type==='i15'){\n  const authored=source.getObjectByName('prop01_1')", "if(type==='i15'||type==='i16'){\n  const authored=source.getObjectByName('prop01_1')")
replace_once("const scaled=['i15','p36a','f3f2','mig3'].includes(type)","const scaled=['i16','i15','p36a','f3f2','mig3'].includes(type)")
module=module.replace("type==='i15'||type==='f3f2'||type==='mig3'","type==='i16'||type==='i15'||type==='f3f2'||type==='mig3'")

calibration=json.loads((root/'baseline/chase-camera-calibration-v17.json').read_text())
for type,data in calibration['planes'].items():
 start=module.index(type+':{',module.index('const AIRCRAFT_SPECS='));end=start+len(type)+1;depth=0
 while True:
  depth+=(module[end]=='{')-(module[end]=='}');end+=1
  if depth==0:break
 spec=module[start:end];spec=re.sub(r',chaseOffsetMeters:[^,}]+','',spec);spec=re.sub(r',chaseHeightMeters:[^,}]+','',spec)
 spec=spec.replace('modelFile:',f"chaseOffsetMeters:{data['tailBackMeters']},chaseHeightMeters:{data['heightMeters']},modelFile:",1)
 module=module[:start]+spec+module[end:]
narrow={type:[data['narrowCenterBackMeters'],data['narrowHeightMeters']] for type,data in calibration['planes'].items()}
camera_helper="""const CHASE_REFERENCE_ASPECT=2048/920;
const CHASE_NARROW_PRESETS="""+json.dumps(narrow,separators=(',',':'))+""";
function chaseFrameOffsets(type,aspect=camera.aspect){
 const spec=AIRCRAFT_SPECS[type],baseBack=spec.lengthMeters*.5+spec.chaseOffsetMeters,baseHeight=spec.chaseHeightMeters,narrow=CHASE_NARROW_PRESETS[type];
 const t=(CHASE_REFERENCE_ASPECT/Math.max(aspect,1)-1)/(CHASE_REFERENCE_ASPECT/(16/9)-1);
 return{backMeters:baseBack+(narrow[0]-baseBack)*t,heightMeters:baseHeight+(narrow[1]-baseHeight)*t}
}
"""
old=function_text('updateChaseCamera');begin=old.index(' const trackedPose=');end=old.index(' const desiredPosition=',begin)
old=old[:begin]+" const trackedPose=baseViewPose.clone().multiply(orbit),offset=chaseFrameOffsets(playerPlane),tailDistance=offset.backMeters/METERS_PER_UNIT,chaseHeight=offset.heightMeters/METERS_PER_UNIT;\n"+old[end:]
replace_function('updateChaseCamera',camera_helper+old)
old=function_text('updateAirspaceSpectatorCamera')
old=old.replace("distance=Math.max(3,root.userData.lengthMeters*1.7/METERS_PER_UNIT),position=root.position.clone().add(new THREE.Vector3(0,distance*.35,distance).applyQuaternion(pose))","offset=chaseFrameOffsets(root.userData.type),position=root.position.clone().add(new THREE.Vector3(0,offset.heightMeters/METERS_PER_UNIT,offset.backMeters/METERS_PER_UNIT).applyQuaternion(pose))")
old=old.replace('new THREE.Vector3(0,0,-distance*2)','new THREE.Vector3(0,0,-100)')
replace_function('updateAirspaceSpectatorCamera',old)

replace_once('function saveHangar(){', (root/'v17-progression.mjs').read_text()+'\nfunction saveHangar(){')
replace_function('saveHangar',"function saveHangar(){try{localStorage.setItem(PROFILE_KEY,JSON.stringify({version:2,unlocked:unlockedPlanes,selected:selectedAircraft,bomberLoadout:selectedBombPayload,economy}))}catch{}}")
# The original card function is replaced by the richer function in the helper.
original_card_start=module.index('function treeVehicleCard(',module.index('function saveHangar('));original_card_end=module.index('\nfunction renderResearch()',original_card_start)
module=module[:original_card_start]+module[original_card_end:]
old=function_text('renderResearch').replace("types:['i15','mig3','mig15']","types:['i15','i16','mig3','mig15']")
old=old.replace("const types=nations.flatMap(n=>n.types);$('#ownedCount').textContent=String(types.length).padStart(2,'0');","const types=nations.flatMap(n=>n.types).filter(type=>unlockedPlanes.includes(type));$('#ownedCount').textContent=String(types.length).padStart(2,'0');")
old=old.replace("setSelectedAircraft(button.dataset.treePlane);renderResearch()","handleResearchAircraft(button.dataset.treePlane)")
old=old.replace("const host=$('#researchTree')", "updateEconomyDisplay();const host=$('#researchTree')")
replace_function('renderResearch',old)
replace_once("function reset(options={}){", "function reset(options={}){beginSortieEconomy();")
replace_once("function updateNonAirspaceStep(dt){", "function updateNonAirspaceStep(dt){\n  battleRewardSeconds+=dt;")
old=function_text('updateAirspaceStep');old=old.replace('function updateAirspaceStep(dt){', 'function updateAirspaceStep(dt){\n if(playing)battleRewardSeconds+=dt;')
replace_function('updateAirspaceStep',old)
old=function_text('finishAirspaceBattle');old=old.replace('function finishAirspaceBattle(winner){','function finishAirspaceBattle(winner){\n if(ended)return;');old=old.replace("$('#end').classList.remove('hidden')","$('#end').classList.remove('hidden');settleSortieEconomy(winner===null?null:winner==='blue')")
replace_function('finishAirspaceBattle',old)
old=function_text('finish');old=old.replace('function finish(win){','function finish(win){\n if(ended)return;');old=old.replace("$('#end').classList.remove('hidden')","$('#end').classList.remove('hidden');settleSortieEconomy(win)")
replace_function('finish',old)
replace_once('async function prepareCampaignBattle(){',"async function prepareCampaignBattle(){\n if(!unlockedPlanes.includes('mig15')){toast('请先研发并购买 MiG-15');showMenuScreen('research');return}")
old=function_text('showMenuScreen').replace("if(id==='hangar')renderHangar();", "updateEconomyDisplay();if(id==='hangar')renderHangar();")
replace_function('showMenuScreen',old)
old=function_text('setCatalogSpecs').replace('previewCamera.lookAt(0,0,0)}','previewCamera.lookAt(0,0,0);updateEconomyDisplay()}')
replace_function('setCatalogSpecs',old)
replace_once("init();showMenuScreen('menu');","loadProgressionProfile();init();renderHangar();showMenuScreen('menu');")

before=before.replace(' · v16',' · v17').replace('当前已开放 10 架机型','11 架机型 · 逐级研发').replace('id="ownedCount">10','id="ownedCount">02')
before=before.replace('<div class="planes">','<div class="planes"><button class="plane-option" data-preview-plane="i16"><b>I-16 type 5</b><span>苏系 1.3 · I级 · 单发战斗机</span></button>',1)
wallet='<div class="wallet"><span>研发点 <b data-wallet-rp>0</b></span><span>GP <b data-wallet-gp>2,000</b></span></div>'
before=before.replace('<div class="menu-grid">',wallet+'<div class="menu-grid">',1)
before=before.replace('<div class="hangar-list" id="hangarList">',wallet+'<div class="hangar-list" id="hangarList">',1)
before=before.replace('<div class="tech-toolbar">',wallet+'<p class="progression-rule">权重阶段：1.0 → 1.3 → 2.3 → 6.7 → 8.0。前一阶段入库任意一架即可研发下一阶段；同权重无需全部解锁。研发完成后使用 GP 购买入库。</p><div class="tech-toolbar">',1)
before=before.replace('选择国家查看分级研发路线，点击机型即可设为当前出战战机。','选择国家查看机型。完成对局获得研发点与 GP，点击可研发飞机投入研发点。')
before=before.replace('<div class="end-actions">','<p class="sortie-rewards hidden" id="sortieRewards" role="status"></p><div class="end-actions">',1)
css="""
.wallet{display:flex;flex-wrap:wrap;gap:8px 22px;padding:8px 12px;margin:10px 0;border:1px solid #7fd9e855;background:#0a2130;color:#c9e8ef;font-size:12px}.wallet b{font:700 15px monospace;color:#ffcf71;margin-left:5px}
.progression-rule{font-size:11px!important;line-height:1.6!important;color:#b7d9e3!important;margin:5px 0 12px!important}
.tech-node{min-height:111px}.node-copy{gap:4px}.node-copy em{line-height:1.4;white-space:normal}.research-blocked{opacity:.55;cursor:default}.research-progress{display:block;height:4px;background:#06162299;overflow:hidden;border-radius:2px}.research-progress i{display:block;height:100%;background:#80d9e9}.research-action{font-size:10px;font-weight:700;color:#ffdc86}.sortie-rewards{color:#ffdc86!important;font-size:15px!important;padding:10px;border:1px solid #a2cbce55;background:#102934}
.branch-vehicles{flex-wrap:wrap}.tech-summary small{line-height:1.5}.plane-option:disabled{opacity:.6}
"""
before=before.replace('</style>',css+'</style>')
html=before+'<script type="module">'+module+'</script>'+after
(root/'app/src/main/assets/index.html').write_text(html);(root/'game.mjs').write_text(module)
gradle=(root/'app/build.gradle').read_text();gradle=re.sub(r'versionCode \d+','versionCode 17',gradle);(root/'app/build.gradle').write_text(gradle)
print('Generated v17: eleven calibrated aircraft, I-16 and progression/GP')
