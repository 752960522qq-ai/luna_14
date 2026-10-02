from pathlib import Path
import re,hashlib

root=Path(__file__).resolve().parent
base=root/'baseline/v11-index.html';html=base.read_text()
before,rest=html.split('<script type="module">',1);module,after=rest.split('</script>',1)
before=before.replace(' · v10',' · v12')
assert hashlib.sha256(base.read_bytes()).hexdigest()=='de5a299094a467b68b55fd0b3ccf17e3eecc8fd40c98e444d0aa9c8d287a7459','Unexpected v11 game page'
fragment=(root/'audio-systems-v12.mjs').read_text()
start=module.index('const AUDIO_FILES=');end=module.index('function updateEngineUI(',start)
module=module[:start]+fragment+'\n'+module[end:]
module=module.replace("if(!((type==='i15bis'||type==='bf109b1'||type==='p36a')&&!isEnemy))playSfx(gunSoundFor(type,id),.22)","playGunShot(gunSoundFor(type,id),from,isEnemy,60/spec.rpm)",1)
module=module.replace("setPV1GunLoop((playerPlane==='i15bis'||playerPlane==='bf109b1'||playerPlane==='p36a')&&keys.fire&&(playerPlane==='p36a'?(playerAmmo.m2+playerAmmo.mg762)>0:playerAmmo.mg>0));",'',1)
module=module.replace('updateBomberGunAudio(dt);updatePV1GunAudio(dt);','',1)
module=module.replace('setBomberGunLoop(false);setPV1GunLoop(false);','stopGunSounds();')
module=module.replace('setBomberGunLoop(false);','stopGunSounds();')
module=module.replace("if(type==='meteor'||id==='hispano')return'mig23Gun';", "if(type==='meteor'||id==='hispano')return'meteorGun';",1)
module=module.replace("if(type==='i15bis'||type==='bf109b1'||type==='p36a')return'pv1Gun';", "if(type==='p36a'&&id==='m2')return'f86Gun';if(type==='i15bis'||type==='bf109b1'||type==='p36a')return'pv1Gun';",1)
# Turrets emit one sample only when their packet actually consumes ammunition.
module=module.replace("stopPlayerGun=()=>{if(!isEnemy)setBomberGunLoop(false)}", "stopPlayerGun=()=>{}",1)
module=module.replace("if(!isEnemy)setBomberGunLoop(true);",'',1)
module=module.replace("state.b29mg-=rounds;ammoSpent+=rounds;", "state.b29mg-=rounds;ammoSpent+=rounds;playGunShot('b29Gun',from,isEnemy,interval,true);",1)
module=module.replace("function showMenuScreen(id){clearFlightInputs();", "function showMenuScreen(id){stopEngineSound();clearFlightInputs();",1)
module=module.replace("renderControlSettings();\n", "renderControlSettings();\n",1)
module=module.replace("init();showMenuScreen('menu');", """prepareGameAudio();
window.addEventListener('pointerdown',resumeGameAudio,{passive:true});
window.addEventListener('keydown',resumeGameAudio,{passive:true});
window.addEventListener('pointerup',stopPendingGunSounds,{passive:true});
window.addEventListener('pointercancel',stopPendingGunSounds,{passive:true});
window.addEventListener('keyup',stopPendingGunSounds,{passive:true});
init();showMenuScreen('menu');""",1)
assert 'setPV1GunLoop' not in module and 'setBomberGunLoop' not in module
(root/'app/src/main/assets/index.html').write_text(before+'<script type="module">'+module+'</script>'+after)
(root/'game.mjs').write_text(module)
g=root/'app/build.gradle';g.write_text(g.read_text().replace('versionCode 11','versionCode 12'))
print('Generated v12 audio behavior from unchanged v11 baseline')
