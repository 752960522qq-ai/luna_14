"""Reproducible edits of v11's authorized sound assets. Output PCM WAV.

Decoded sample times (not MP3 packet times) retain one attack and remove the
next attack/burst. Engine sections use stationary running noise, a DC filter,
and equal-power overlap so their decoded buffers can loop continuously.
"""
from pathlib import Path
from zipfile import ZipFile
import subprocess, hashlib, json, wave, sys
import numpy as np

ROOT=Path(__file__).resolve().parent
BASE=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT.parent/'sky-duel-flight-v11.apk'
RATE=24000
SHOTS={
 'f86_gun':(.022,.097,.018,.80),
 'b29_gun':(.028,.140,.024,.80),
 'pv1_gun':(.029,.155,.024,.82),
 'mig23_gun':(.032,.173,.025,.82),
 'mig37_gun':(.037,.295,.105,.86),
 'meteor20_gun':(.030,.370,.160,.80),
}
ENGINES={'jet_engine':(24,36,.30,.10),'b29_engine':(9,21,.30,.16),'i15bis_engine':(9,21,.30,.15)}
assert hashlib.sha256(BASE.read_bytes()).hexdigest()=='975b00134a0b84d864fee8812c014fe36a15afcc318cc072ee8ce92f855f6689'
OUT=ROOT/'app/src/main/assets/audio';OUT.mkdir(parents=True,exist_ok=True)
report={'baselineApkSha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),'sampleRate':RATE,'assets':[]}

def decode(raw):
 return np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i','pipe:0','-ac','1','-ar',str(RATE),'-f','f32le','pipe:1'],input=raw),dtype='<f4').copy().astype(np.float64)

def save(name,x,details):
 peak=float(np.max(np.abs(x)));assert peak<=.98
 pcm=np.round(np.clip(x,-.98,.98)*32767).astype('<i2')
 path=OUT/name
 with wave.open(str(path),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(RATE);w.writeframes(pcm.tobytes())
 report['assets'].append(dict(output=name,seconds=len(x)/RATE,peak=peak,rms=float(np.sqrt(np.mean(x*x))),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),**details))

with ZipFile(BASE) as z:
 for name,(start,end,fade,target_peak) in SHOTS.items():
  raw=z.read('assets/audio/'+name+'.mp3');x=decode(raw)[round(start*RATE):round(end*RATE)];x-=np.mean(x)
  # Preserve the short leading transient. Taper only the clip boundary and tail.
  attack=round(.0015*RATE);tail=round(fade*RATE)
  x[:attack]*=np.sin(np.linspace(0,np.pi/2,attack))**2
  x[-tail:]*=np.cos(np.linspace(0,np.pi/2,tail))**2
  x*=target_peak/max(np.max(np.abs(x)),1e-9)
  save(name+'_shot.wav',x,dict(source=name+'.mp3',sourceSha256=hashlib.sha256(raw).hexdigest(),decodedStartSeconds=start,decodedEndSeconds=end,tailFadeSeconds=fade,kind='single-shot'))
 for name,(start,end,overlap,target_rms) in ENGINES.items():
  raw=z.read('assets/audio/'+name+'.mp3');x=decode(raw)[round(start*RATE):round(end*RATE)];x-=np.mean(x)
  n=round(overlap*RATE);phase=np.linspace(0,np.pi/2,n)
  mix=x[-n:]*np.cos(phase)+x[:n]*np.sin(phase)
  x=np.concatenate([x[n:-n],mix]);x*=min(target_rms/max(np.sqrt(np.mean(x*x)),1e-9),.92/max(np.max(np.abs(x)),1e-9))
  seam_delta=float(abs(x[-1]-x[0]));normal_delta=float(np.percentile(np.abs(np.diff(x)),99.5))
  assert seam_delta<=normal_delta,'Discontinuous loop boundary'
  save(name+'_loop.wav',x,dict(source=name+'.mp3',sourceSha256=hashlib.sha256(raw).hexdigest(),decodedStartSeconds=start,decodedEndSeconds=end,overlapSeconds=overlap,kind='running-loop',seamDelta=seam_delta,normalSampleDeltaP995=normal_delta))
(ROOT/'validation/audio-slices-v12.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({'assets':len(report['assets']),'durationSeconds':{x['output']:x['seconds'] for x in report['assets']}},ensure_ascii=False))
