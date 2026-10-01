"""Audio-only update over the verified v11 APK; align/sign with the same key."""
from pathlib import Path
from zipfile import ZipFile
import hashlib,struct,json,sys

root=Path(__file__).resolve().parent
prior=Path(sys.argv[1]) if len(sys.argv)>1 else root.parent/'sky-duel-flight-v11.apk'
assert hashlib.sha256(prior.read_bytes()).hexdigest()=='975b00134a0b84d864fee8812c014fe36a15afcc318cc072ee8ce92f855f6689','Unexpected v11 APK'
old=struct.pack('<HBBI',8,0,0x10,11);new=struct.pack('<HBBI',8,0,0x10,12)
slice_report=json.loads((root/'validation/audio-slices-v12.json').read_text())
replaced_audio={'assets/audio/'+x['source'] for x in slice_report['assets']}
changed=[];unsigned=root/'unsigned-v12.apk'
with ZipFile(prior) as source,ZipFile(unsigned,'w') as target:
 for entry in source.infolist():
  name=entry.filename
  if name.startswith('META-INF/') and (name=='META-INF/MANIFEST.MF' or name.endswith(('.SF','.RSA','.DSA','.EC'))):continue
  if name in replaced_audio:continue
  data=source.read(name)
  if name=='assets/index.html':data=(root/'app/src/main/assets/index.html').read_bytes();changed.append(name)
  elif name=='AndroidManifest.xml':assert data.count(old)==1;data=data.replace(old,new);changed.append(name)
  target.writestr(entry,data)
 for asset in slice_report['assets']:
  file=root/'app/src/main/assets/audio'/asset['output'];assert hashlib.sha256(file.read_bytes()).hexdigest()==asset['sha256']
  target.write(file,'assets/audio/'+asset['output'])
with ZipFile(prior) as source,ZipFile(unsigned) as target:
 assert target.testzip() is None
 assert target.getinfo('resources.arsc').compress_type==0
 retained=[n for n in target.namelist() if n not in changed and not n.startswith('assets/audio/')]
 assert all(target.read(n)==source.read(n) for n in retained)
 assert target.read('assets/audio/kill_confirm.mp3')==source.read('assets/audio/kill_confirm.mp3')
 assert target.read('assets/audio/bomb_drop.mp3')==source.read('assets/audio/bomb_drop.mp3')
 print(json.dumps({'unsigned':str(unsigned),'bytes':unsigned.stat().st_size,'changed':changed,'removedOriginalAudio':sorted(replaced_audio),'addedSlices':len(slice_report['assets']),'retainedEntries':len(retained)},ensure_ascii=False))
