"""Update the verified v16 native shell with v17 assets and versionCode."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import hashlib,struct,sys,json
root=Path(__file__).resolve().parent;base=Path(sys.argv[1]);output=root/'unsigned-v17.apk'
assert hashlib.sha256(base.read_bytes()).hexdigest()=='235cbfbaa766a7a564fe0b0f2db4f84c3114e24035019a780171353c30257ffa'
old=struct.pack('<HBBI',8,0,0x10,16);new=struct.pack('<HBBI',8,0,0x10,17);changed=['assets/index.html','AndroidManifest.xml'];added='assets/i16-type5.glb'
def update_version_code(data):
 # Resolve the versionCode string, then patch only its typed integer attribute.
 # platformBuildVersionName is also the integer 15 (Android 15) and must stay 15.
 assert data[:2]==b'\x03\x00'
 pos=8;strings=None;matches=[]
 while pos<len(data):
  kind,header,size=struct.unpack_from('<HHI',data,pos)
  assert size>=header>=8 and pos+size<=len(data)
  if kind==1:
   count=struct.unpack_from('<I',data,pos+8)[0];flags=struct.unpack_from('<I',data,pos+16)[0];start=struct.unpack_from('<I',data,pos+20)[0]
   assert not flags&0x100,'Expected UTF-16 AXML string pool'
   strings=[]
   for n in range(count):
    offset=struct.unpack_from('<I',data,pos+header+n*4)[0];at=pos+start+offset;length=struct.unpack_from('<H',data,at)[0];at+=2
    if length&0x8000:length=((length&0x7fff)<<16)|struct.unpack_from('<H',data,at)[0];at+=2
    strings.append(data[at:at+length*2].decode('utf-16-le'))
  elif kind==0x102:
   assert strings is not None
   ext=pos+header;name=struct.unpack_from('<I',data,ext+4)[0]
   attr_start,attr_size,attr_count=struct.unpack_from('<HHH',data,ext+8)
   if strings[name]=='manifest':
    for n in range(attr_count):
     at=ext+attr_start+n*attr_size;attr_name=struct.unpack_from('<I',data,at+4)[0]
     if strings[attr_name]=='versionCode':
      assert data[at+12:at+20]==old
      matches.append(at+12)
  pos+=size
 assert pos==len(data) and len(matches)==1
 at=matches[0];return data[:at]+new+data[at+8:]
with ZipFile(base) as source,ZipFile(output,'w') as target:
 assert added not in source.namelist()
 for entry in source.infolist():
  name=entry.filename
  if name.startswith('META-INF/') and (name=='META-INF/MANIFEST.MF' or name.endswith(('.SF','.RSA','.DSA','.EC'))):continue
  data=source.read(name)
  if name=='assets/index.html':data=(root/'app/src/main/assets/index.html').read_bytes()
  elif name=='AndroidManifest.xml':data=update_version_code(data)
  target.writestr(entry,data)
 target.write(root/'app/src/main/assets/i16-type5.glb',added,compress_type=ZIP_DEFLATED)
with ZipFile(base) as source,ZipFile(output) as target:
 assert target.testzip() is None
 retained=[name for name in source.namelist() if not name.startswith('META-INF/') and name not in changed]
 assert all(target.read(name)==source.read(name) for name in retained)
 assert target.getinfo('resources.arsc').compress_type==0
 assert target.read(added)==(root/'app/src/main/assets/i16-type5.glb').read_bytes()
report={'result':'passed','baseSha256':hashlib.sha256(base.read_bytes()).hexdigest(),'unsignedBytes':output.stat().st_size,'changed':changed,'added':[added],'unchangedPayloadCount':len(retained),'unchangedOriginalModelsAudioAndNativeShell':True}
(root/'validation/package-v17.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
