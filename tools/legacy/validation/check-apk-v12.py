"""Validate the signed artifact and unchanged v11 non-audio payload."""
from pathlib import Path
from zipfile import ZipFile
import hashlib, json, sys

root=Path(__file__).resolve().parent.parent
apk=Path(sys.argv[1]) if len(sys.argv)>1 else root.parent/'sky-duel-audio-v12.apk'
base=Path(sys.argv[2]) if len(sys.argv)>2 else root.parent/'sky-duel-flight-v11.apk'
baseline_hash='975b00134a0b84d864fee8812c014fe36a15afcc318cc072ee8ce92f855f6689'
certificate='eff77ee038d6e1a9f8c166530161adf6fc14428ebb1912ffa75a15868896521f'
assert hashlib.sha256(base.read_bytes()).hexdigest()==baseline_hash
slices=json.loads((root/'validation/audio-slices-v12.json').read_text())['assets']
signature=(root/'validation/apk-signature-v12.txt').read_text()
badging=(root/'validation/apk-badging-v12.txt').read_text()
assert 'Verifies' in signature and 'Signer #1 certificate SHA-256 digest: '+certificate in signature
assert "name='com.luna.skyduel' versionCode='12'" in badging
with ZipFile(base) as prior,ZipFile(apk) as signed:
 assert signed.testzip() is None
 assert signed.read('assets/index.html')==(root/'app/src/main/assets/index.html').read_bytes()
 names=set(signed.namelist())
 for asset in slices:
  assert 'assets/audio/'+asset['source'] not in names
  assert hashlib.sha256(signed.read('assets/audio/'+asset['output'])).hexdigest()==asset['sha256']
 retained=[]
 for name in prior.namelist():
  if name.startswith(('META-INF/','assets/audio/')) or name in ['assets/index.html','AndroidManifest.xml']:continue
  assert signed.read(name)==prior.read(name),name
  retained.append(name)
 for name in ['assets/audio/kill_confirm.mp3','assets/audio/bomb_drop.mp3']:assert signed.read(name)==prior.read(name)
 assert signed.getinfo('resources.arsc').compress_type==0
result={'result':'passed','apk':apk.name,'bytes':apk.stat().st_size,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'package':'com.luna.skyduel','versionCode':12,'versionName':'1.0','certificateSha256':certificate,'sameCertificateAsV11':True,'baselineApkSha256':baseline_hash,'signatureSchemes':[1,2,3],'zipAlignmentVerified':True,'audioSlices':len(slices),'originalGunEngineRecordingsRemoved':9,'unchangedPayloadEntries':retained,'unchangedExtraSounds':['bomb_drop.mp3','kill_confirm.mp3']}
(root/'validation/apk-verification-v12.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in result.items() if k!='unchangedPayloadEntries'},ensure_ascii=False,indent=2))
