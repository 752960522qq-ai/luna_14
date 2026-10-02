"""Generate the offline v15 page from the verified v14 baseline."""
from pathlib import Path
import hashlib, re
root = Path(__file__).resolve().parent
base = root/'baseline/v14-index.html'
assert hashlib.sha256(base.read_bytes()).hexdigest() == '96999d134a2db7a076177bd6b76a99a9e1db901cb3fbe399c701db98337ae9ea'
before,rest = base.read_text().split('<script type="module">',1)
module,after = rest.split('</script>',1)
def replace_once(old,new):
    global module
    assert module.count(old) == 1, (old,module.count(old))
    module = module.replace(old,new,1)

replace_once('teamSize:8','teamSize:5')
replace_once('8 V 8','5 V 5')
for aircraft,length in [('mig15','10.10'),('f86','11.4'),('meteor','12.6'),('b29','30.18')]:
    replace_once('lengthMeters:'+length+',rollRateDps:', 'lengthMeters:'+length+',chaseOffsetMeters:1,rollRateDps:')
replace_once('const AIRCRAFT_SPECS={',"const AIRCRAFT_SPECS={mig3:{modelFile:'./mig3.glb',lengthMeters:8.25,chaseOffsetMeters:2.7,levelDragCompensation:.018,rollRateDps:120,control:{stickAttackSeconds:.06,stickReleaseSeconds:.08,rollResponse:9,rollRelease:11,pitchResponse:6.8},axisFlip:[1,1,1],collisionMeters:{x:10.231,y:3.287,z:8.25}},")
replace_once('const PROPELLER_SPECS={',"const PROPELLER_SPECS={mig3:{idleRpm:600,maxRpm:2400,direction:1,spoolUpSeconds:2.7,spoolDownSeconds:3.5,blurStartRpm:850,blurFullRpm:1400,radius:1.50},")
replace_once('const AIRCRAFT_TREE={',"const AIRCRAFT_TREE={mig3:{nation:'ussr',nationName:'苏系',rating:2.3,rank:'II',branch:'单发战斗机'},")
module = module.replace("'bf109b1','p36a','f3f2']","'bf109b1','p36a','f3f2','mig3']")
replace_once("name:'苏系 · 苏联',types:['mig15']", "name:'苏系 · 苏联',types:['mig3','mig15']")
replace_once('const planeInfo={',"""const planeInfo={mig3:{name:'MiG-3',health:480,maxSpeedKmh:640,minLevelFlightKmh:155,bestClimbMps:15.8,turnTimeS:24,horizontalTurnRateDps:360/24,verticalTurnTimeS:13.2,verticalTurnRateDps:360/13.2,turnRadiusM:300,intro:'二战苏联高空拦截战斗机，高空极速优秀，擅长万米高度拦截轰炸机；低空水平盘旋性能较差，发动机脆弱，适合抢占高度后俯冲攻击，避免长时间水平狗斗。',specs:[['系别','苏联'],['等级','II'],['战机权重','2.3'],['机体耐久','480'],['最大航速','640 km/h'],['最小航速','155 km/h'],['最佳爬升率','15.8 m/s'],['水平转弯性能','24秒'],['垂直转弯性能','13.2秒'],['12.7mm UBS别列津机枪','1挺 · 备弹280发 · 1000发/分钟 · 伤害28 · 弹速860 m/s'],['7.62mm ShKAS施卡斯机枪','2挺 · 合计备弹1500发 · 单管1800发/分钟 · 伤害15 · 弹速820 m/s']]},""")
replace_once('const weaponInfo={',"const weaponInfo={mig3:{m2:{rpm:1000,damage:28,speed:860,cost:1,count:1,radius:.08,color:0xffdf96,offsets:[[0,.047,-.29]]},mg762:{rpm:1800,damage:15,speed:820,cost:2,count:2,radius:.06,color:0xffdf96,offsets:[[-.019,.04,-.29],[.019,.04,-.29]]}},")
replace_once('const AI_FIGHTER={',"const AI_FIGHTER={mig3:{detectMeters:2500,loseMeters:3000,alignMeters:750,breakMeters:130,passSeconds:2.7,gun:{m2:{rangeMeters:600,coneDeg:6},mg762:{rangeMeters:550,coneDeg:6.5}}},")
replace_once("function freshAmmo(type){", "function freshAmmo(type){if(type==='mig3')return{mg:0,m2:280,mg762:1500,n37:0,ns23:0,hispano:0};")
replace_once("return(type==='p36a'||type==='f3f2')?['m2','mg762']", "return(type==='mig3'||type==='p36a'||type==='f3f2')?['m2','mg762']")
replace_once("function updateAmmoUI(){", "function updateAmmoUI(){if(playerPlane==='mig3'){$('#ammo').textContent=`UBS ${playerAmmo.m2} / 280 · ShKAS ${playerAmmo.mg762} / 1500`;$('#ammoBar').style.width=((playerAmmo.m2+playerAmmo.mg762)/1780*100)+'%'}else ")
replace_once("function gunSoundFor(type,id){", "function gunSoundFor(type,id){if(type==='mig3')return'pv1Gun';")
replace_once("const scaled=['p36a','f3f2'].includes(type)", "const scaled=['p36a','f3f2','mig3'].includes(type)")
replace_once("disc.name='PropellerMotionBlur';if(type==='f3f2')", "disc.name='PropellerMotionBlur';if(type==='f3f2'||type==='mig3')")
replace_once("const spinAxis=type==='f3f2'?", "const spinAxis=type==='f3f2'||type==='mig3'?")
replace_once('function attachPropeller(root,source,spec){',(root/'mig3-gear-v15.mjs').read_text()+'\nfunction attachPropeller(root,source,spec){')
replace_once('root.add(model);configureCombatLandingGear(root,model);root.userData.modelAttached=true','root.add(model);configureCombatLandingGear(root,model);configureMiG3CombatLandingGear(root,model);root.userData.modelAttached=true')
replace_once('}).catch(()=>{root.userData.modelError=true});',"}).catch(error=>{console.error('战机模型初始化失败：'+type,error);root.userData.modelError=true});")
replace_once("enemyPlaneType==='mig15'?'MIG-15':enemyPlaneType==='meteor'?'Meteor F.4':enemyPlaneType==='b29'?'B-29':enemyPlaneType==='bf109b1'?'Bf-109 B-1':enemyPlaneType==='i15bis'?'I-15bis':enemyPlaneType==='p36a'?'P-36A':'F-86'", "planeInfo[enemyPlaneType].name")

before = before.replace(' · v14',' · v15').replace('8 V 8','5 V 5')
before = before.replace('id="blueAlive">8</b> / 8','id="blueAlive">5</b> / 5').replace('id="redAlive">8</b> / 8','id="redAlive">5</b> / 5')
before = before.replace('当前已开放 8 架机型','当前已开放 9 架机型').replace('id="ownedCount">07','id="ownedCount">09')
brand = '<div class="brand">FLIGHT SIMULATION<b>天空决斗 / SKY DUEL</b></div>'
assert before.count(brand) == 1
before = before.replace(brand,'')
catalog = '<button class="plane-option" data-preview-plane="mig3"><b>MiG-3</b><span>苏系 2.3 · II级 · 高空截击机</span></button>'
before = before.replace('<div class="planes">','<div class="planes">'+catalog)
# Preserve the artist credit inside the installed offline app.
credit = '<p class="terrain-credit">MiG-3 模型：manilov.ap / Sketchfab，CC BY 4.0；已校正方向、统一比例并添加螺旋桨旋转节点。 <a href="https://sketchfab.com/3d-models/mig3-6ba63e06628e491a9836e4a9c54c50f1" target="_blank" rel="noopener">源模型</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">许可</a></p>'
before = before.replace('<div class="catalog-actions">',credit+'<div class="catalog-actions">')
# Both modes use the original campaign throttle dimensions.
before = before.replace('.hud.airspace .throttle-control{top:35%;bottom:24%}','').replace('.hud.airspace .throttle-control{top:50%;bottom:24%}','')
css = '''
/* The objective sits on the top edge; readouts have their own clear row. */
.hud .radar-box{left:3.2%;right:auto;top:8px}
.hud .top{left:140px;right:120px;top:74px;justify-content:center}
.hud .readout{gap:clamp(12px,2vw,24px)}
.hud .readout strong{font-size:clamp(16px,2.5vw,25px)}
#campaignHud,#airspaceHud{top:0;max-width:calc(100vw - 210px);border-top:0;border-radius:0 0 8px 8px}
#campaignHud{white-space:normal;text-align:center;overflow:visible;line-height:1.5}
#airspaceHud{gap:8px;justify-content:center}
#airspaceHud .a-point-panel{min-width:140px}
.hud .throttle-control{top:25%;bottom:25%}
@media(max-height:500px){.hud .top{top:65px}.hud .readout label{font-size:8px}.hud .readout strong{font-size:17px}}
@media(max-width:640px){.hud .top{left:100px;right:95px;top:65px}.hud .readout{gap:10px}.hud .readout label{font-size:7px;letter-spacing:0}.hud .readout strong{font-size:14px}#campaignHud,#airspaceHud{max-width:calc(100vw - 180px);font-size:9px;padding:6px;gap:4px}#airspaceHud .a-point-panel{min-width:118px}#airspaceHud .team-score{font-size:8px}#airspaceHud .team-score strong{font-size:16px;margin:0 2px}}
'''
before = before.replace('</style>',css+'</style>')
before = '\n'.join(line.rstrip() for line in before.split('\n'))
(root/'app/src/main/assets/index.html').write_text(before+'<script type="module">'+module+'</script>'+after)
(root/'game.mjs').write_text(module)
gradle = root/'app/build.gradle'
gradle.write_text(re.sub(r'versionCode \d+','versionCode 15',gradle.read_text()))
print('Generated v15: MiG-3, 5v5, camera offsets and HUD fixes')
