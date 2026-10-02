"""Generate the offline page deterministically from the verified v13 baseline."""
from pathlib import Path
import hashlib,re

root=Path(__file__).resolve().parent
base=root/'baseline/v13-index.html'
assert hashlib.sha256(base.read_bytes()).hexdigest()=='e90fab0a5c4a6fe76d03375a0b92b04f95c868402c64781b165ea914402cbca9'
before,rest=base.read_text().split('<script type="module">',1)
module,after=rest.split('</script>',1)

def replace_once(old,new):
 global module
 assert module.count(old)==1,(old,module.count(old))
 module=module.replace(old,new,1)

def function_span(name):
 start=module.index('function '+name+'(')
 i=module.index('(',start);depth=1
 while depth:
  i+=1
  if module[i]=='(':depth+=1
  elif module[i]==')':depth-=1
 end=module.index('{',i);depth=1
 while depth:
  end+=1
  if module[end]=='{':depth+=1
  elif module[end]=='}':depth-=1
 return start,end+1

def prefix_function(name,code):
 start,end=function_span(name);opening=module.index('{',start)
 # Parameter defaults can include braces; locate the function's body after ')'.
 i=module.index('(',start);depth=1
 while depth:
  i+=1
  if module[i]=='(':depth+=1
  elif module[i]==')':depth-=1
 opening=module.index('{',i)
 replace_once(module[start:opening+1],module[start:opening+1]+'\n '+code+'\n')

# Catalog data itself is normalized, not only the visible labels.
start=module.index('const planeInfo=');end=module.index('const weaponInfo=',start)
info=module[start:end]
info=info.replace('，起落架可收放。','。').replace('；低于最小平飞速度后升力衰减并进入失速。','。').replace('低于最小平飞速度后升力衰减并进入失速。','')
info=re.sub(r"\['(?:追尾视角|起落架)','[^']*'\],?",'',info)
info=re.sub(r"\['(最大航速|最大平飞速度|最小航速|最小平飞航速|最小平飞速度)','([^']*)'\]",lambda m:"['"+('最大航速' if m[1].startswith('最大') else '最小航速')+"','"+re.sub(r'[（(][^）)]*[）)]','',m[2]).strip()+"']",info)
horizontal=['水平持续转弯','水平360°回转','360°回转时间','水平转弯半径','转弯半径']
vertical=['俯仰响应上限','垂直360°转向参数','垂直瞬时转弯']
# Combine multiple horizontal rows while retaining their original values.
for name in ['f3f2','i15bis','p36a','bf109b1','mig15','f86','meteor','b29']:
 match=re.search(r'\b'+name+r':\{.*?specs:\[(.*?)\]\}',info,re.S);assert match,name
 rows=re.findall(r"\['([^']*)','([^']*)'\]",match[1]);horizontal_values=[]
 for label,value in rows:
  if label in horizontal:
   horizontal_values.append(('360° ' if label=='360°回转时间' else '半径 ' if '半径' in label else '')+value)
 out=[];written=False
 for label,value in rows:
  if label in horizontal:
   if not written:out.append(('水平转弯性能',' · '.join(horizontal_values)));written=True
  elif label in vertical:out.append(('垂直转弯性能',value))
  else:out.append((label,value))
 spec=','.join("['"+label+"','"+value+"']" for label,value in out)
 info=info[:match.start(1)]+spec+info[match.end(1):]
module=module[:start]+info+module[end:]

replace_once("let gameMode='duel'","let gameMode='airspace'")
replace_once("const CONTROL_SETTINGS_KEY=",(root/'airspace-systems-v14.mjs').read_text()+'\nconst CONTROL_SETTINGS_KEY=')
prefix_function('availableCursorTargets',"if(gameMode==='airspace')return airspacePlayerAlive()?airspaceLiveUnits('red').map(unit=>unit.root):[];")
prefix_function('updateCursorTarget',"if(gameMode==='airspace'&&!airspacePlayerAlive()){cursorTarget=null;return}")
prefix_function('updateFlightAimingHUD',"if(gameMode==='airspace'&&airspaceSpectating){for(const id of ['reticle','aimCursor','leadIndicator'])$('#'+id).style.display='none';$('#cursorStatus').classList.add('hidden');return}")
replace_once('playing=true;player.userData.engineRunning=pausedEngineRunning;',"playing=true;player.userData.engineRunning=airspacePlayerAlive()&&pausedEngineRunning;")
replace_once("startEngineSound(playerPlane);clock.getDelta();toast('继续战斗')","if(airspacePlayerAlive())startEngineSound(playerPlane);clock.getDelta();toast('继续战斗')")
replace_once('updatePropeller(player,dt);updatePropeller(enemy,dt);\n for(const target of campaignBombers)updatePropeller(target.root,dt);\n for(const target of campaignEscorts)updatePropeller(target.root,dt);',"if(gameMode!=='airspace'){updatePropeller(player,dt);updatePropeller(enemy,dt);for(const target of campaignBombers)updatePropeller(target.root,dt);for(const target of campaignEscorts)updatePropeller(target.root,dt)}\n if(gameMode==='airspace'&&battlePaused)return;")
replace_once("const roots=[player,...(gameMode==='campaign'?campaignTargets().map(t=>t.root):[enemy])];","const roots=gameMode==='airspace'?airspaceLiveUnits().map(unit=>unit.root):[player,...(gameMode==='campaign'?campaignTargets().map(t=>t.root):[enemy])];")
prefix_function('updateHealthUI',"if(gameMode==='airspace'){updateAirspaceHealthUI();return}")
prefix_function('cycleWeaponMode',"if(gameMode==='airspace'&&!airspacePlayerAlive())return;")
replace_once("weaponMode=weaponMode==='n37'?'ns23':weaponMode==='ns23'?'both':'n37';updateAmmoUI();", "weaponMode=weaponMode==='n37'?'ns23':weaponMode==='ns23'?'both':'n37';if(gameMode==='airspace'){const unit=airspaceUnitFor(player);if(unit)unit.weaponMode=weaponMode}updateAmmoUI();")
start,end=function_span('fireWeapons');old=module[start:end]
declaration=old[old.index(' const type='):old.index('\n let ammoChanged=')]
replacement=" const unit=gameMode==='airspace'?from.userData.airspaceUnit:null;\n const type=unit?.type||(isEnemy?(gameMode==='campaign'?(from.userData.type||'f86'):enemyPlaneType):playerPlane),state=unit?.ammo||(isEnemy?(gameMode==='campaign'?from.userData.ammo:enemyAmmo):playerAmmo),cooldowns=unit?.weaponCooldowns||(isEnemy?(gameMode==='campaign'?from.userData.weaponCooldowns:enemyWeaponCooldowns):playerWeaponCooldowns),mode=unit?(unit.isPlayer?weaponMode:unit.weaponMode):(isEnemy?(gameMode==='campaign'?from.userData.weaponMode:enemyWeaponMode):weaponMode);\n if(unit?.dead)return;"
replace_once(declaration,replacement)
replace_once('bullet.enemy=isEnemy;bullet.damage=bulletDamage;',"bullet.enemy=isEnemy;bullet.team=unit?.team||(isEnemy?'red':'blue');bullet.shooterId=unit?.id||null;bullet.damage=bulletDamage;")
prefix_function('fireBomberTurrets',"if(gameMode==='airspace'){fireAirspaceBomberTurrets(airspaceUnitFor(from),dt);return}")
prefix_function('dropBomb',"if(gameMode==='airspace'&&!airspacePlayerAlive())return;")
prefix_function('updateDroppedBombs',"if(gameMode==='airspace'){updateAirspaceBombs(dt);return}")
replace_once('clearCampaignEntities();for(const wreck', 'clearCampaignEntities();clearAirspaceEntities();for(const wreck')
replace_once("setBattleMap(gameMode==='campaign'?'korea1951':(Math.random()<.5?'openSea':'korea1951'));", "setBattleMap(gameMode==='campaign'||gameMode==='airspace'?'korea1951':(Math.random()<.5?'openSea':'korea1951'));groundPlane.scale.setScalar(gameMode==='airspace'?600/2200:1);")
replace_once("if(gameMode==='campaign')startCampaign();else{campaignElapsed=0;spawnEnemy", "if(gameMode==='airspace')startAirspaceBattle();else if(gameMode==='campaign')startCampaign();else{campaignElapsed=0;spawnEnemy")
replace_once("toast(gameMode==='campaign'?'米格之舞：1951·朝鲜':'进入战区 · '+MAP_LIBRARY[activeMapId].name)", "toast(gameMode==='airspace'?'空域争夺 · 8 V 8 · 抢占 A 点':gameMode==='campaign'?'米格之舞：1951·朝鲜':'进入战区 · '+MAP_LIBRARY[activeMapId].name)")
prefix_function('damage',"if(gameMode==='airspace'){damageAirspaceUnit(target==='player'?airspaceUnitFor(player):campaignTarget||airspaceUnitFor(enemy),n);return}")
prefix_function('finish',"if(gameMode==='airspace'){finishAirspaceBattle(win===null?null:win?'blue':'red');return}")
prefix_function('updateTacticalDisplay',"if(gameMode==='airspace'){updateAirspaceTacticalDisplay();return}")
module=module.replace("if(gameMode==='duel'){const b=terrainBattleBounds();", "if(gameMode==='duel'||gameMode==='airspace'){const b=terrainBattleBounds();")
module=module.replace("ai.role==='escort'?root.userData.ammo:enemyAmmo", "ai.role==='escort'||ai.role==='airspace'?root.userData.ammo:enemyAmmo")
module=module.replace("ai.role==='escort'?root.userData.weaponMode:enemyWeaponMode", "ai.role==='escort'||ai.role==='airspace'?root.userData.weaponMode:enemyWeaponMode")
module=module.replace("ai.role==='escort'?data.ammo:enemyAmmo", "ai.role==='escort'||ai.role==='airspace'?data.ammo:enemyAmmo")
module=module.replace("ai.role==='escort'?data.weaponMode:enemyWeaponMode", "ai.role==='escort'||ai.role==='airspace'?data.weaponMode:enemyWeaponMode")
replace_once('function updateFighterAI(root,target,center,dt){','function updateFighterAI(root,target,center,dt,orderGoal=null){')
replace_once('const toGoal=safeAIGoal(root,ai.goal).sub(root.position)', 'const toGoal=safeAIGoal(root,orderGoal||ai.goal).sub(root.position)')
replace_once("}else data.throttle=ai.state==='RECOVER'?.95:","}else if(ai.role==='airspace'&&orderGoal)data.throttle=ai.state==='RECOVER'?.95:data.airspaceNavigationThrottle;else data.throttle=ai.state==='RECOVER'?.95:")
replace_once('fireWeapons(root,true,dt,aiFireIntent(root,target))','fireWeapons(root,true,dt,orderGoal?false:aiFireIntent(root,target))')
replace_once('const boundaryGoal=duelBoundaryReturnGoal(root),direction=boundaryGoal?boundaryGoal.sub(root.position):toGoal;', 'const boundaryGoal=duelBoundaryReturnGoal(root),direction=ai.role===\'airspace\'&&orderGoal?airspaceFlightDirection(root,boundaryGoal||safeAIGoal(root,orderGoal)):boundaryGoal?boundaryGoal.sub(root.position):toGoal;')
replace_once('worldTime+=elapsed;\n if(playing){',"if(gameMode!=='airspace')worldTime+=elapsed;\n if(gameMode==='airspace'&&airspaceState)updateAirspaceFrame(elapsed,dt);else if(playing){")
prefix_function('terrainBattleBounds',"if(gameMode==='airspace'){const half=6000/(2*METERS_PER_UNIT);return{minX:-half,maxX:half,minZ:-half,maxZ:half}}")
replace_once("if(gameMode!=='duel')return null;", "if(gameMode!=='duel'&&gameMode!=='airspace')return null;")
replace_once("if(gameMode!=='duel'||!root)return;", "if((gameMode!=='duel'&&gameMode!=='airspace')||!root)return;")
prefix_function('updateDuelBoundary',"if(gameMode==='airspace'){if(!playing||!airspacePlayerAlive()){resetDuelBoundary();return}}")
replace_once("if(gameMode!=='duel'||!playing||!player){if(gameMode!=='duel')resetDuelBoundary();return}","if((gameMode!=='duel'&&gameMode!=='airspace')||!playing||!player){if(gameMode!=='duel'&&gameMode!=='airspace')resetDuelBoundary();return}")
replace_once('enforceDuelAIBoundary(enemy);\n if(outsideTerrainMeters(player.position)',"if(gameMode==='duel')enforceDuelAIBoundary(enemy);\n if(outsideTerrainMeters(player.position)")
replace_once("hp=0;player.userData.desertionDestroyed=true;updateHealthUI();finish(false);", "if(gameMode==='airspace'){player.userData.desertionDestroyed=true;damageAirspaceUnit(airspaceUnitFor(player),airspaceUnitFor(player).health);toast('越界超过15秒 · 战机自毁，进入观战');return}\n  hp=0;player.userData.desertionDestroyed=true;updateHealthUI();finish(false);")
prefix_function('showMenuScreen',"airspacePrepareToken++;$('#chooseAIBattle').disabled=false;$('#airspaceLoadStatus').textContent='';")
replace_once("$('#chooseAIBattle').addEventListener('click',()=>{gameMode='duel';reset()});", "$('#chooseAIBattle').addEventListener('click',prepareAirspaceBattle);$('#spectatePrevious').addEventListener('click',()=>cycleAirspaceSpectator(-1));$('#spectateNext').addEventListener('click',()=>cycleAirspaceSpectator(1));")
# Flight/fire handlers must not operate the destroyed player while spectating.
replace_once("if(e.button!==undefined&&e.button!==0)return;e.preventDefault();keys[k]=true;", "if(!playing||gameMode==='airspace'&&airspaceSpectating&&k!=='look'||e.button!==undefined&&e.button!==0)return;e.preventDefault();keys[k]=true;")
replace_once("if(pressed&&!playing)return;const k=keyMap", "if(pressed&&!playing)return;if(gameMode==='airspace'&&airspaceSpectating&&e.key.toLowerCase()!=='c')return;const k=keyMap")
replace_once("window.addEventListener('keydown',e=>{if(playing&&e.key.toLowerCase()==='x')", "window.addEventListener('keydown',e=>{if(playing&&gameMode==='airspace'&&airspaceSpectating&&['q','e'].includes(e.key.toLowerCase())){cycleAirspaceSpectator(e.key.toLowerCase()==='q'?-1:1);e.preventDefault();return}if(playing&&e.key.toLowerCase()==='x')")
replace_once("if(controlSettings.mode==='cursor'&&!keys.look){", "if(controlSettings.mode==='cursor'&&!keys.look&&!(gameMode==='airspace'&&airspaceSpectating)){")
replace_once("if(!playing||controlSettings.mode!=='joystick'||", "if(!playing||gameMode==='airspace'&&airspaceSpectating||controlSettings.mode!=='joystick'||")
replace_once("if(!playing||(throttlePointer!==null", "if(!playing||gameMode==='airspace'&&airspaceSpectating||(throttlePointer!==null")

before=before.replace(' · v13',' · v14').replace('<small>A-B: 2000 m</small>','<small id="radarScale">6 × 6 km</small>')
before=before.replace('选择一场历史战役，或进入原有的自由 AI 对战。','选择历史战役，或带领编队争夺中央空域。')
before=before.replace('<strong>AI对战</strong><span>使用当前战机，随机抽取地图与权重相差不超过 1.0 的对手。</span>','<strong>空域争夺模式</strong><span>8 V 8 · 6 × 6 km · 队友与敌机 BR 均为所选飞机 ±1.0</span>')
brief='<div class="airspace-brief"><p><b>争夺 A 点</b>：地图中央半径300 m的球形空域，以标记高度为准，范围不显示。点内我方人数大于敌方才能占领；中立点15秒，敌占点30秒，人数相等暂停进度。</p><p><b>补给与胜负</b>：两队从对角基地出发。回己方基地300 m内，每秒恢复10%生命和弹药。占领 A 点每秒获得1分，先到100分或全歼对方获胜。全员仅一条命；玩家被击落后观战队友。</p><p id="airspaceLoadStatus" role="status" aria-live="polite"></p></div>'
before=before.replace('</div><p class="terrain-credit">', '</div>'+brief+'<p class="terrain-credit">',1)
hud='<div class="airspace-hud hidden" id="airspaceHud"><div class="team-score blue-team">我方 <b id="blueAlive">8</b> / 8 <strong id="blueScore">0</strong></div><div class="a-point-panel"><b id="aPointStatus">A · 中立</b><div class="capture-track"><span id="aCaptureRed"></span><span id="aCaptureBlue"></span><i></i></div><small id="aCaptureText">点内 0 : 0 · 等待进入</small><small id="baseSupplyStatus">回我方基地补给</small></div><div class="team-score red-team"><strong id="redScore">0</strong> 敌方 <b id="redAlive">8</b> / 8</div></div><div class="airspace-marker-layer hidden" id="airspaceMarkers"></div><div class="spectator-controls hidden" id="spectatorControls"><button id="spectatePrevious" type="button" aria-label="观战上一架队友">←</button><span id="spectatorLabel">观战队友</span><button id="spectateNext" type="button" aria-label="观战下一架队友">→</button></div>'
before=before.replace('<div class="boundary-warning hidden"',hud+'<div class="boundary-warning hidden"',1)
css='''
.airspace-brief{margin:0 0 12px;padding:12px 14px;border:1px solid #7fd9e833;background:#091a29}.airspace-brief p{font-size:11px;line-height:1.6;margin:0 0 8px}.airspace-brief p:last-child{margin:0;color:#ffcf71}.airspace-brief b{color:#9be8f4}.mode-card:disabled{opacity:.5}.airspace-hud{position:absolute;left:50%;top:13%;transform:translateX(-50%);display:flex;gap:10px;align-items:flex-start;padding:8px 12px;background:#061522da;border:1px solid #b4e9f044;border-radius:8px;max-width:70vw;font:11px monospace;z-index:6}.team-score{white-space:nowrap;padding-top:2px}.team-score strong{font-size:22px;margin:0 5px}.blue-team{color:#76d5ff}.red-team{color:#ff8580}.a-point-panel{text-align:center;min-width:160px}.a-point-panel>b{color:#ffcf71}.a-point-panel small{display:block;font-size:9px;color:#d5e1e8;line-height:1.5}.capture-track{position:relative;height:5px;background:#ffffff20;margin:5px 0;border-radius:3px;overflow:hidden}.capture-track span{position:absolute;height:100%;width:0}.capture-track #aCaptureBlue{left:50%;background:#76d5ff}.capture-track #aCaptureRed{right:50%;background:#ff8580}.capture-track i{position:absolute;left:50%;width:1px;height:100%;background:white}.airspace-marker-layer{position:absolute;inset:0;pointer-events:none;z-index:4}.airspace-marker{position:absolute;width:14px;height:14px;border:1px solid currentColor;transform:translate(-50%,-50%);text-shadow:0 1px 3px #000}.airspace-marker .marker-label{position:absolute;top:16px;left:50%;transform:translateX(-50%);white-space:nowrap;font:8px monospace}.airspace-marker.offscreen{width:8px;height:8px;opacity:.8;transform:translate(-50%,-50%) rotate(45deg)}.airspace-marker.offscreen .marker-label{display:none}.spectator-controls{position:absolute;bottom:8%;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;background:#071827ed;padding:10px;border:1px solid #7fd9e866;border-radius:8px;pointer-events:auto;z-index:7}.spectator-controls button{width:42px;height:38px;background:#14354a;border:1px solid #7fd9e866;color:#d9f7ff;font-size:20px;border-radius:5px}.spectator-controls span{font-size:12px;white-space:nowrap}.hud.spectating .joystick,.hud.spectating .action,.hud.spectating .bottom-left,.hud.spectating .cursor-status{display:none!important}.hud.spectating .free-look{display:block!important}.hud.spectating .target{top:38%}@media(max-width:640px){.airspace-hud{top:17%;padding:6px 8px;gap:5px;max-width:82vw;font-size:9px}.team-score strong{font-size:16px;margin:0 2px}.a-point-panel{min-width:140px}.a-point-panel small{font-size:8px}.airspace-brief p{font-size:10px}.spectator-controls span{font-size:10px}.spectator-controls{gap:7px}.mode-grid{margin:12px 0}.mode-card{min-height:80px;padding:12px}}
'''
before=before.replace('</style>',css+'</style>')
before=before.replace('</style>', '''.hud.airspace .throttle-control{top:35%;bottom:24%}.hud.airspace .toast{top:26%;font-size:14px}.hud.airspace .cursor-status{max-width:48vw}@media(max-height:500px){.hud.airspace .throttle-control{top:50%;bottom:24%}.hud.airspace .toast{top:34%;font-size:12px}.airspace-hud{top:17%;padding:6px 8px;font-size:9px}.team-score strong{font-size:16px}.a-point-panel{min-width:140px}.a-point-panel small{font-size:8px}.airspace-brief p{font-size:10px}} </style>''')
(root/'app/src/main/assets/index.html').write_text(before+'<script type="module">'+module+'</script>'+after)
(root/'game.mjs').write_text(module)
gradle=root/'app/build.gradle';gradle.write_text(re.sub(r'versionCode \d+','versionCode 14',gradle.read_text()))
print('Generated v14: catalog cleanup and 8v8 airspace control')
