from pathlib import Path
import re,hashlib

root=Path(__file__).resolve().parent
base=root/'baseline/v10-index.html'
if not base.exists():base=root.parent/'luna_14-v10/app/src/main/assets/index.html'
assert hashlib.sha256(base.read_bytes()).hexdigest()=='22755c8aed9e136fe164e6005191cbfbbb48c4480a264678f61bc69149144f53','Unexpected v10 game page'
html=base.read_text()
before,module_after=html.split('<script type="module">',1)
module,after=module_after.split('</script>',1)
fragment=(root/'flight-systems-v11.mjs').read_text()

def functions(text):
    out={}
    for m in re.finditer(r'^function (\w+)\(',text,re.M):
        pos=text.index('{',m.start());end=pos;depth=1
        while depth:
            end+=1
            if text[end]=='{':depth+=1
            elif text[end]=='}':depth-=1
        out[m.group(1)]=text[m.start():end+1]
    return out

original=functions(module);new=functions(fragment)
for name,fn in new.items():
    if name in original:module=module.replace(original[name],fn,1)
    else:module+='\n'+fn+'\n'
declarations=fragment[fragment.index('const FLIGHT_PHYSICS='):fragment.index('function moveCursorDirection(')]
module=module.replace("import { DRACOLoader } from './DRACOLoader.js';", "import { DRACOLoader } from './DRACOLoader.js';\n"+declarations,1)
module=module.replace('throttleValue=.78','throttleValue=1',1)
module=module.replace("const MAP_LIBRARY={openSea:{name:'远洋空域'}", "const MAP_LIBRARY={openSea:{name:'远洋空域',sizeMeters:22000}",1)
module=module.replace("$('#cursorStatus').classList.toggle('hidden',!isCursor);", "$('#cursorStatus').classList.remove('hidden');",1)
module=module.replace("if(!isCursor){$('#aimCursor').style.display='none';$('#leadIndicator').style.display='none'}", "if(!isCursor)$('#aimCursor').style.display='none';",1)
module=module.replace("松手停止操纵，拖动空白区域可自由观察。", "松手停止操纵，拖动空白区域可自由观察。指向敌机显示预瞄点，实际准星对齐后开火。",1)
module=module.replace("?cursorViewQuaternion():player.quaternion.clone()", "?cursorChaseQuaternion():player.quaternion.clone()",1)
module=module.replace("koreaTerrain=terrain;", "const coverage=new THREE.Box3().setFromObject(terrain);\n  koreaTerrainBounds={minX:coverage.min.x,maxX:coverage.max.x,minZ:coverage.min.z,maxZ:coverage.max.z};\n  koreaTerrain=terrain;",1)
module=module.replace("function reset(){battlePaused=false;", "function reset(){throttleValue=1;resetDuelBoundary();battlePaused=false;",1)
module=module.replace("function finish(win){battlePaused=false;", "function finish(win){resetDuelBoundary();battlePaused=false;",1)
module=module.replace("function updateThrottleUI(){const info=", "function updateThrottleUI(){$('#throttlePercent').textContent=Math.round(throttleValue*100)+'%';const info=",1)
module=module.replace("const safe=goal.clone(),half=activeMapId==='korea1951'?265:290;\n if(activeMapId==='korea1951')", "const safe=goal.clone(),half=activeMapId==='korea1951'?265:290;\n if(gameMode==='duel'){const b=terrainBattleBounds();safe.x=THREE.MathUtils.clamp(safe.x,b.minX,b.maxX);safe.z=THREE.MathUtils.clamp(safe.z,b.minZ,b.maxZ)}\n else if(activeMapId==='korea1951')",1)
module=module.replace("if(ai.state!=='FIRE_PASS'||local.z>=0)return intent;", "if(data.boundaryReturning||data.instructorRecovering||ai.state!=='FIRE_PASS'||local.z>=0)return intent;",1)
module=module.replace(" if(ai.state==='RECOVER')recoverAircraftAttitude(root,dt);\n else if(toGoal.lengthSq()>.001)steerAircraftToward(root,toGoal,dt);\n",'',1)
needle=" advanceAircraft(root,dt);\n const actualForward="
replacement=""" const boundaryGoal=duelBoundaryReturnGoal(root),direction=boundaryGoal?boundaryGoal.sub(root.position):toGoal;
 const count=Math.max(1,Math.ceil(dt/FLIGHT_PHYSICS.stepSeconds)),step=dt/count;
 for(let i=0;i<count;i++){
  if(ai.state==='RECOVER'&&!boundaryGoal)recoverAircraftAttitude(root,step);
  else if(direction.lengthSq()>.001)steerAircraftToward(root,direction,step);
  advanceAircraft(root,step);enforceDuelAIBoundary(root)
 }
 if(ai.telemetry)ai.telemetry.boundaryReturning=!!data.boundaryReturning;
 const actualForward="""
assert needle in module
module=module.replace(needle,replacement,1)
module=module.replace(" if(enemy&&enemy.position.y<terrainHeightAt", " enforceDuelAIBoundary(enemy);\n if(enemy&&enemy.position.y<terrainHeightAt",1)
module=module.replace("  steerAircraftToward(enemy,goal.sub(enemy.position),dt);advanceAircraft(enemy,dt)", """  const boundaryGoal=duelBoundaryReturnGoal(enemy),direction=(boundaryGoal||goal).sub(enemy.position);
  const count=Math.max(1,Math.ceil(dt/FLIGHT_PHYSICS.stepSeconds)),step=dt/count;
  for(let i=0;i<count;i++){steerAircraftToward(enemy,direction,step);advanceAircraft(enemy,step);enforceDuelAIBoundary(enemy)}""",1)
module=module.replace("const dt=Math.min(clock.getDelta(),.04);worldTime+=dt;", "const elapsed=Math.max(0,clock.getDelta()),dt=Math.min(elapsed,.1);worldTime+=elapsed;",1)
module=module.replace("  if(playing){if(gameMode==='campaign')updateCampaign(dt);else updateDuelEnemy(dt)}", "  if(playing){if(gameMode==='campaign')updateCampaign(dt);else updateDuelEnemy(dt)}\n  if(playing)updateDuelBoundary(elapsed);",1)
module=module.replace("player.userData.throttle=throttleValue;$('#throttleControl')", "player.userData.throttle=throttleValue;$('#throttlePercent').textContent=Math.round(throttleValue*100)+'%';$('#throttleControl')",1)
# Keep the HUD labels accurate: these values cap attitude/curvature, not every-speed telemetry.
module=module.replace("['垂直瞬时转弯'", "['俯仰响应上限'")
before=before.replace('<span class="throttle-title">油门</span>', '<span class="throttle-title">油门 <b id="throttlePercent">100%</b></span>',1)
before=before.replace('<div class="reticle" id="reticle">', '<div class="boundary-warning hidden" id="boundaryWarning" role="status" aria-live="polite"></div><div class="reticle" id="reticle">',1)
before=before.replace('</style>', "#throttlePercent{font:700 10px monospace;color:#a4eff5}.boundary-warning{position:absolute;left:50%;top:19%;transform:translateX(-50%);max-width:86%;padding:9px 16px;border:1px solid #ff8179;border-radius:8px;background:#5b1819df;color:#fff1dc;font-size:clamp(13px,2.4vw,19px);font-weight:800;text-align:center;pointer-events:none;text-shadow:0 1px 4px #000}.boundary-warning.hidden{display:none!important}\n</style>",1)
asset=root/'app/src/main/assets/index.html'
asset.write_text(before+'<script type="module">'+module+'</script>'+after)
(root/'game.mjs').write_text(module)
gradle=root/'app/build.gradle'
gradle.write_text(gradle.read_text().replace('versionCode 10','versionCode 11'))
print('Generated v11 module and HTML from unchanged v10 baseline')
