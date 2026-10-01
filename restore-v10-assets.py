"""Restore unchanged v10 assets for running the standalone v11 patch's checks."""
from pathlib import Path
from zipfile import ZipFile
import hashlib, sys

root = Path(__file__).resolve().parent
apk = Path(sys.argv[1])
assert hashlib.sha256(apk.read_bytes()).hexdigest() == 'd114a5008af11850a2acc3cee74151eb08ce960f77f622c0bfaa6cca24658ce6', 'Unexpected v10 APK'
with ZipFile(apk) as source:
    for entry in source.infolist():
        if entry.filename.startswith('assets/') and entry.filename != 'assets/index.html':
            relative = Path(entry.filename).relative_to('assets')
            assert not relative.is_absolute() and '..' not in relative.parts
            target = root / 'app/src/main/assets' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read(entry))
print('Restored unchanged v10 assets; v11 game page retained')
