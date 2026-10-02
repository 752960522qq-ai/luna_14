from pathlib import Path
import hashlib

root=Path(__file__).resolve().parent
base=root/'baseline/v12-index.html'
assert hashlib.sha256(base.read_bytes()).hexdigest()=='1208940ffb9cca5dfee3dc348dcf6dc5ec59d9c4c5005604b35c1b8cfa6ea524'
html=base.read_text();before,rest=html.split('<script type="module">',1);module,after=rest.split('</script>',1)
def replace_once(old,new):
 global module
 assert module.count(old)==1,(old,module.count(old))
 module=module.replace(old,new,1)
def entry(name,value):replace_once('const '+name+'={','const '+name+'={f3f2:'+value+',')
entry('AIRCRAFT_SPECS',"{modelFile:'./f3f2_yellow_wings.glb',lengthMeters:7.06,chaseOffsetMeters:2.3,rollRateDps:145,levelDragCompensation:.018,highSpeedTurnDrag:.014,control:{stickAttackSeconds:.05,stickReleaseSeconds:.07,rollResponse:11,rollRelease:13,pitchResponse:8},axisFlip:[1,1,1],collisionMeters:{x:9.807017,y:2.81643,z:7.06}}")
entry('PROPELLER_SPECS',"{idleRpm:550,maxRpm:1900,direction:1,spoolUpSeconds:2.8,spoolDownSeconds:3.7,blurStartRpm:800,blurFullRpm:1250,radius:1.40}")
entry('AIRCRAFT_TREE',"{nation:'us',nationName:'美系',rating:1.3,rank:'I',branch:'双翼战斗机'}")
entry('weaponInfo',"{m2:{rpm:750,damage:34,speed:860,cost:1,count:1,radius:.08,color:0xffdf96,offsets:[[.018,-.040,-.30]]},mg762:{rpm:1000,damage:13,speed:810,cost:1,count:1,radius:.06,color:0xffdf96,offsets:[[-.018,-.040,-.30]]}}")
entry('AI_FIGHTER',"{detectMeters:2350,loseMeters:2850,alignMeters:600,breakMeters:100,passSeconds:2.5,gun:{m2:{rangeMeters:520,coneDeg:6.5},mg762:{rangeMeters:480,coneDeg:6.8}}}")
entry('planeInfo',"""{name:'F3F-2',health:360,maxSpeedKmh:425,minLevelFlightKmh:118,bestClimbMps:14.0,turnTimeS:16.5,horizontalTurnRateDps:360/16.5,verticalTurnTimeS:10.1,verticalTurnRateDps:360/10.1,turnRadiusM:145,intro:'美军末代舰载双翼战斗机，拥有极为优秀的水平盘旋能力，低空机动灵活；极速偏低，高速下能量损耗严重，适合低速缠斗，不适合与高速单翼机进行俯冲交战，起落架可收放。',specs:[['系别','美国'],['战机权重','美系 1.3'],['机体耐久','360'],['机长','7.06 m'],['最大航速','425 km/h（4600 m）'],['最小航速','118 km/h（失速临界）'],['最佳爬升率','14.0 m/s'],['水平360°回转','16.5 s · 21.82°/s'],['垂直360°转向参数','10.1 s · 35.64°/s'],['武器','1挺 12.7 mm M2勃朗宁 + 1挺 7.62 mm勃朗宁'],['备弹','M2：200发；7.62 mm：500发'],['射速','M2：750发/分；7.62 mm：1000发/分'],['单发伤害','M2：34；7.62 mm：13'],['弹速','M2：860 m/s；7.62 mm：810 m/s'],['追尾视角','机后上方 2.3 m'],['起落架','战斗向后收起；图鉴保留原姿态']]}""")
# Make the aircraft available to both new profiles and upgrades from existing saves.
module=module.replace("'bf109b1','p36a'","'bf109b1','p36a','f3f2'")
replace_once("types:['p36a','b29','f86']","types:['f3f2','p36a','b29','f86']")
replace_once("if(type==='p36a')return{mg:0,m2:200,mg762:500", "if(type==='p36a'||type==='f3f2')return{mg:0,m2:200,mg762:500")
replace_once("return type==='p36a'?['m2','mg762']", "return(type==='p36a'||type==='f3f2')?['m2','mg762']")
replace_once("else if(playerPlane==='p36a')", "else if(playerPlane==='p36a'||playerPlane==='f3f2')")
replace_once("if(type==='p36a'&&id==='m2')", "if((type==='p36a'||type==='f3f2')&&id==='m2')")
replace_once("if(type==='i15bis'||type==='bf109b1'||type==='p36a')return'pv1Gun'", "if(type==='i15bis'||type==='bf109b1'||type==='p36a'||type==='f3f2')return'pv1Gun'")
replace_once("(type==='i15bis'||type==='bf109b1'||type==='p36a')?'prop':'jet'", "PROPELLER_SPECS[type]?'prop':'jet'")
# Each instance declares its context before its asynchronous model load completes.
replace_once('function aircraft(isPlayer,type){','function aircraft(isPlayer,type,options={}){')
replace_once('root.userData={type,lengthMeters,','root.userData={modelContext:options.preview?\'preview\':\'combat\',type,lengthMeters,')
replace_once('root.add(model);root.userData.modelAttached=true','root.add(model);configureCombatLandingGear(root,model);root.userData.modelAttached=true')
replace_once('previewPlane=aircraft(false,type);','previewPlane=aircraft(false,type,{preview:true});')
start=module.index('function attachPropeller(');end=module.index('function updatePropeller(',start)
module=module[:start]+(root/'aircraft-systems-v13.mjs').read_text()+'\n'+module[end:]
# The original camera offsets remain unchanged for the existing aircraft.
replace_once("tailOffsetMeters=(playerPlane==='bf109b1'||playerPlane==='p36a')?3:Math.max(7,lengthMeters*.95)", "tailOffsetMeters=AIRCRAFT_SPECS[playerPlane].chaseOffsetMeters??((playerPlane==='bf109b1'||playerPlane==='p36a')?3:Math.max(7,lengthMeters*.95))")
replace_once("const chaseHeight=(playerPlane==='bf109b1'||playerPlane==='p36a')?3/METERS_PER_UNIT:tailDistance*Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))*.58;", "const chaseHeight=AIRCRAFT_SPECS[playerPlane].chaseOffsetMeters!==undefined?AIRCRAFT_SPECS[playerPlane].chaseOffsetMeters/METERS_PER_UNIT:(playerPlane==='bf109b1'||playerPlane==='p36a')?3/METERS_PER_UNIT:tailDistance*Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))*.58;")
# F3F-2 alone loses more energy during high-speed loaded turns; straight-line tuning is preserved.
replace_once('+.002*turnLoad*turnLoad;', '+.002*turnLoad*turnLoad+(AIRCRAFT_SPECS[data.type].highSpeedTurnDrag||0)*turnLoad*turnLoad*THREE.MathUtils.smoothstep(speed,data.maxSpeedMps*.75,data.maxSpeedMps);')
# Offset only F3F-2's nominal level drag so its fully-spooled cruise reaches the supplied 425 km/h.
replace_once('(data.maxSpeedMps*throttle-along)*.85,0,', '(data.maxSpeedMps*throttle-along)*.85+(AIRCRAFT_SPECS[data.type].levelDragCompensation||0)*along,0,')
before=before.replace(' · v12',' · v13').replace('当前已开放 7 架机型','当前已开放 8 架机型')
button='<button class="plane-option" data-preview-plane="f3f2"><b>F3F-2</b><span>美系 1.3 · 舰载双翼战斗机</span></button>'
assert '<button class="plane-option" data-preview-plane="p36a">' in before
before=before.replace('<button class="plane-option" data-preview-plane="p36a">',button+'<button class="plane-option" data-preview-plane="p36a">',1)
(root/'app/src/main/assets/index.html').write_text(before+'<script type="module">'+module+'</script>'+after)
(root/'game.mjs').write_text(module)
gradle=root/'app/build.gradle';gradle.write_text(gradle.read_text().replace('versionCode 12','versionCode 13'))
print('Generated v13 from verified v12 page: F3F-2 and combat-only landing gear')
