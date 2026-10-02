"""Restore unchanged native/model resources; retain the v12 page and WAV slices."""
from pathlib import Path
from zipfile import ZipFile
import hashlib, sys

root=Path(__file__).resolve().parent
apk=Path(sys.argv[1])
assert hashlib.sha256(apk.read_bytes()).hexdigest()=='975b00134a0b84d864fee8812c014fe36a15afcc318cc072ee8ce92f855f6689','Unexpected v11 APK'
with ZipFile(apk) as z:
 for entry in z.infolist():
  if entry.filename.startswith('assets/') and entry.filename!='assets/index.html':
   relative=Path(entry.filename).relative_to('assets')
   assert not relative.is_absolute() and '..' not in relative.parts
   target=root/'app/src/main/assets'/relative
   target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(entry))
print('Restored verified v11 resources; v12 page and PCM slices retained')
