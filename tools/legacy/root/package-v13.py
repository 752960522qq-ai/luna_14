"""Patch the verified v12 native APK; retain its audio/model payload verbatim."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib, struct, sys, json

root=Path(__file__).resolve().parent
base=Path(sys.argv[1]) if len(sys.argv)>1 else root.parent/'sky-duel-audio-v12.apk'
assert hashlib.sha256(base.read_bytes()).hexdigest()=='d3ce5696d2dd523fff08ad0561205879a4887761a80c2cac95ebf85b5245f187'
old=struct.pack('<HBBI',8,0,0x10,12);new=struct.pack('<HBBI',8,0,0x10,13)
output=root/'unsigned-v13.apk';changed=['assets/index.html','AndroidManifest.xml'];added='assets/f3f2_yellow_wings.glb'
with ZipFile(base) as source,ZipFile(output,'w') as target:
 for entry in source.infolist():
  name=entry.filename
  if name.startswith('META-INF/') and (name=='META-INF/MANIFEST.MF' or name.endswith(('.SF','.RSA','.DSA','.EC'))):continue
  data=source.read(name)
  if name=='assets/index.html':data=(root/'app/src/main/assets/index.html').read_bytes()
  elif name=='AndroidManifest.xml':assert data.count(old)==1;data=data.replace(old,new)
  target.writestr(entry,data)
 target.write(root/'app/src/main/assets/f3f2_yellow_wings.glb',added,compress_type=ZIP_DEFLATED,compresslevel=6)
with ZipFile(base) as source,ZipFile(output) as target:
 assert target.testzip() is None
 retained=[n for n in source.namelist() if not n.startswith('META-INF/') and n not in changed]
 assert all(target.read(n)==source.read(n) for n in retained)
 assert target.getinfo('resources.arsc').compress_type==0
report={'result':'passed','baseSha256':hashlib.sha256(base.read_bytes()).hexdigest(),'unsignedBytes':output.stat().st_size,'changed':changed,'addedModel':added,'addedModelSha256':hashlib.sha256((root/'app/src/main/assets/f3f2_yellow_wings.glb').read_bytes()).hexdigest(),'unchangedPayloadCount':len(retained),'unchangedV12Audio':True}
(root/'validation/package-v13.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
