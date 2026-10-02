"""Restore unchanged runtime assets from the exact v9 APK; retain the v10 index."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import sys

root = Path(__file__).resolve().parent
if len(sys.argv) != 2:
    raise SystemExit('Usage: python restore-v9-assets.py /path/to/original-v9.apk')
prior = Path(sys.argv[1])
expected = 'e92cabb3253ea301167beffea7789507f1a795e053426bab5c74f5033d1ec261'
if hashlib.sha256(prior.read_bytes()).hexdigest() != expected:
    raise SystemExit('Unexpected base APK: use the original sky-duel-p36a-v9(1).apk')
asset_root = root / 'app/src/main/assets'
restored = 0
with ZipFile(prior) as archive:
    for name in archive.namelist():
        if not name.startswith('assets/') or name.endswith('/') or name == 'assets/index.html':
            continue
        destination = asset_root / name.removeprefix('assets/')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(archive.read(name))
        restored += 1
print(f'Restored {restored} unchanged v9 assets; retained v10 index.html.')
