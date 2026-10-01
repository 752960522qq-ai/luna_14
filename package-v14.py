"""Update the verified v13 native APK while retaining every other payload byte."""
from pathlib import Path
from zipfile import ZipFile
import hashlib,struct,sys,json
root=Path(__file__).resolve().parent
base=Path(sys.argv[1])
assert hashlib.sha256(base.read_bytes()).hexdigest()=='94bb52cbe867026467b3932fe41030f59019372b557c945489b39adbddaa2d3f'
old=struct.pack('<HBBI',8,0,0x10,13);new=struct.pack('<HBBI',8,0,0x10,14)
output=root/'unsigned-v14.apk';changed=['assets/index.html','AndroidManifest.xml']
with ZipFile(base) as source,ZipFile(output,'w') as target:
 for entry in source.infolist():
  name=entry.filename
  if name.startswith('META-INF/') and (name=='META-INF/MANIFEST.MF' or name.endswith(('.SF','.RSA','.DSA','.EC'))):continue
  data=source.read(name)
  if name=='assets/index.html':data=(root/'app/src/main/assets/index.html').read_bytes()
  elif name=='AndroidManifest.xml':assert data.count(old)==1;data=data.replace(old,new)
  target.writestr(entry,data)
with ZipFile(base) as source,ZipFile(output) as target:
 assert target.testzip() is None
 retained=[name for name in source.namelist() if not name.startswith('META-INF/') and name not in changed]
 assert all(target.read(name)==source.read(name) for name in retained)
 assert target.getinfo('resources.arsc').compress_type==0
report={'result':'passed','baseSha256':hashlib.sha256(base.read_bytes()).hexdigest(),'unsignedBytes':output.stat().st_size,'changed':changed,'unchangedPayloadCount':len(retained),'unchangedModelsAudioAndNativeShell':True}
(root/'validation/package-v14.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
