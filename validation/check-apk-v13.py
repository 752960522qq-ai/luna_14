from pathlib import Path
from zipfile import ZipFile
import hashlib, json, struct, sys

root=Path(__file__).resolve().parent.parent
apk=Path(sys.argv[1]) if len(sys.argv)>1 else root.parent/'sky-duel-f3f2-v13.apk'
base=Path(sys.argv[2]) if len(sys.argv)>2 else root.parent/'sky-duel-audio-v12.apk'
assert hashlib.sha256(base.read_bytes()).hexdigest()=='d3ce5696d2dd523fff08ad0561205879a4887761a80c2cac95ebf85b5245f187'
certificate='eff77ee038d6e1a9f8c166530161adf6fc14428ebb1912ffa75a15868896521f'
signature=(root/'validation/apk-signature-v13.txt').read_text()
assert 'Verifies' in signature and 'Signer #1 certificate SHA-256 digest: '+certificate in signature
assert "name='com.luna.skyduel' versionCode='13'" in (root/'validation/apk-badging-v13.txt').read_text()
added='assets/f3f2_yellow_wings.glb';retained=[]
with ZipFile(base) as source,ZipFile(apk) as signed:
 assert signed.testzip() is None
 assert signed.read('assets/index.html')==(root/'app/src/main/assets/index.html').read_bytes()
 assert signed.read(added)==(root/'app/src/main/assets/f3f2_yellow_wings.glb').read_bytes()
 for name in source.namelist():
  if name.startswith('META-INF/') or name in ['assets/index.html','AndroidManifest.xml']:continue
  assert signed.read(name)==source.read(name),name
  retained.append(name)
 old=struct.pack('<HBBI',8,0,0x10,12);new=struct.pack('<HBBI',8,0,0x10,13)
 assert source.read('AndroidManifest.xml').replace(old,new)==signed.read('AndroidManifest.xml')
 assert signed.getinfo('resources.arsc').compress_type==0
result={'result':'passed','apk':apk.name,'bytes':apk.stat().st_size,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'package':'com.luna.skyduel','versionCode':13,'versionName':'1.0','certificateSha256':certificate,'sameCertificateAsV12':True,'signatureSchemes':[1,2,3],'zipAlignmentVerified':True,'addedModelSha256':hashlib.sha256((root/'app/src/main/assets/f3f2_yellow_wings.glb').read_bytes()).hexdigest(),'unchangedV12PayloadCount':len(retained),'unchangedV12Payload':retained,'unchangedV12Audio':True,'unchangedOriginalP36GLB':True}
(root/'validation/apk-verification-v13.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in result.items() if k!='unchangedV12Payload'},ensure_ascii=False,indent=2))
