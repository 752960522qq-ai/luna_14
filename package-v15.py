"""Update the verified v14 APK, retaining its native shell and original assets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib,struct,sys,json
root=Path(__file__).resolve().parent
base=Path(sys.argv[1])
assert hashlib.sha256(base.read_bytes()).hexdigest()=='414ab8a3050367d1bc1a000ea593fbecb9d95a1b3a27f954bb524914e597b96e'
old=struct.pack('<HBBI',8,0,0x10,14);new=struct.pack('<HBBI',8,0,0x10,15)
output=root/'unsigned-v15.apk';changed=['assets/index.html','AndroidManifest.xml'];added=['assets/mig3.glb']
with ZipFile(base) as source,ZipFile(output,'w') as target:
 for entry in source.infolist():
  name=entry.filename
  if name.startswith('META-INF/') and (name=='META-INF/MANIFEST.MF' or name.endswith(('.SF','.RSA','.DSA','.EC'))):continue
  data=source.read(name)
  if name=='assets/index.html':data=(root/'app/src/main/assets/index.html').read_bytes()
  elif name=='AndroidManifest.xml':assert data.count(old)==1;data=data.replace(old,new)
  target.writestr(entry,data)
 target.write(root/'app/src/main/assets/mig3.glb','assets/mig3.glb',compress_type=ZIP_DEFLATED)
with ZipFile(base) as source,ZipFile(output) as target:
 assert target.testzip() is None
 retained=[name for name in source.namelist() if not name.startswith('META-INF/') and name not in changed]
 assert all(target.read(name)==source.read(name) for name in retained)
 assert target.getinfo('resources.arsc').compress_type==0
 assert target.read('assets/mig3.glb')==(root/'app/src/main/assets/mig3.glb').read_bytes()
report={'result':'passed','baseSha256':hashlib.sha256(base.read_bytes()).hexdigest(),'unsignedBytes':output.stat().st_size,'changed':changed,'added':added,'unchangedPayloadCount':len(retained),'unchangedOriginalModelsAudioAndNativeShell':True}
(root/'validation/package-v15.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
