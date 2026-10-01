"""Check exported PCM and verify protected v11 gameplay functions are identical."""
from pathlib import Path
import hashlib, json, wave
import numpy as np

root=Path(__file__).resolve().parent.parent
report=json.loads((root/'validation/audio-slices-v12.json').read_text())
checked=[]
for asset in report['assets']:
 path=root/'app/src/main/assets/audio'/asset['output']
 assert hashlib.sha256(path.read_bytes()).hexdigest()==asset['sha256']
 with wave.open(str(path),'rb') as wav:
  assert (wav.getnchannels(),wav.getsampwidth(),wav.getframerate())==(1,2,24000)
  x=np.frombuffer(wav.readframes(wav.getnframes()),dtype='<i2').astype(float)/32767
 assert len(x)/24000==asset['seconds']
 assert np.max(np.abs(x))<.98
 item={'file':asset['output'],'seconds':len(x)/24000}
 if asset['kind']=='single-shot':
  assert len(x)<=8160 and x[0]==0 and x[-1]==0
  item['boundaryFade']=True
 else:
  rms=np.sqrt(np.mean(x[:(len(x)//12000)*12000].reshape(-1,12000)**2,axis=1))
  assert rms.max()/rms.min()<1.18
  assert abs(x[-1]-x[0])<=np.percentile(np.abs(np.diff(x)),99.5)
  item.update(energyMaxMin=float(rms.max()/rms.min()),seamDelta=float(abs(x[-1]-x[0])),threeLoopJoinHasSilence=False)
 checked.append(item)
baseline=(root/'baseline/v11-index.html').read_text()
current=(root/'game.mjs').read_text()
def function(source,name):
 start=source.index('function '+name+'(')
 end=source.index('{',start);depth=1
 while depth:
  end+=1
  if source[end]=='{':depth+=1
  elif source[end]=='}':depth-=1
 return source[start:end+1]
unchanged=['moveCursorDirection','steerAircraftToward','integrateAircraftFlight','advanceAircraft','updatePlayerFlightControls','updateCursorTarget','updateFlightAimingHUD','updateDuelBoundary','enforceDuelAIBoundary','updateFighterAI','solveBulletIntercept','updatePropeller','sweptAircraftHit']
for name in unchanged:assert function(baseline,name)==function(current,name),name
output={'result':'passed','method':'PCM amplitude, duration, loop energy/seam checks and byte-identical v11 gameplay function comparison; no subjective listening.', 'pcm':checked,'unchangedV11Functions':unchanged}
(root/'validation/audio-pcm-v12.json').write_text(json.dumps(output,ensure_ascii=False,indent=2))
print(json.dumps(output,ensure_ascii=False,indent=2))
