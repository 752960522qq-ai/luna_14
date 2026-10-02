"""Create an unsigned v11 update from the verified v10 APK. Align/sign separately.

Only the embedded game page and Android versionCode change. The prior native
shell, DEX, Seven aircraft models, terrain, audio and runtime dependencies remain
byte-identical. Signing credentials are intentionally external to this patch.
"""
from pathlib import Path
from zipfile import ZipFile
import struct, hashlib, json, sys

root = Path(__file__).resolve().parent
prior = Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / 'sky-duel-controls-v10.apk'
unsigned = root / 'unsigned-v11.apk'
asset = root / 'app/src/main/assets/index.html'
old = struct.pack('<HBBI', 8, 0, 0x10, 10)
new = struct.pack('<HBBI', 8, 0, 0x10, 11)
assert hashlib.sha256(prior.read_bytes()).hexdigest() == 'd114a5008af11850a2acc3cee74151eb08ce960f77f622c0bfaa6cca24658ce6', 'Unexpected v10 base APK'
changes = []
with ZipFile(prior) as source, ZipFile(unsigned, 'w') as target:
    for entry in source.infolist():
        name = entry.filename
        if name.startswith('META-INF/') and (name == 'META-INF/MANIFEST.MF' or name.endswith(('.SF', '.RSA', '.DSA', '.EC'))):
            continue
        data = source.read(name)
        if name == 'assets/index.html':
            data = asset.read_bytes()
            changes.append(name)
        elif name == 'AndroidManifest.xml':
            assert data.count(old) == 1, 'Expected versionCode 10 once'
            data = data.replace(old, new)
            changes.append(name)
        target.writestr(entry, data)
with ZipFile(prior) as source, ZipFile(unsigned) as output:
    assert output.testzip() is None
    assert output.getinfo('resources.arsc').compress_type == 0
    assert output.read('assets/index.html') == asset.read_bytes()
    kept = [n for n in output.namelist() if n not in changes]
    assert all(source.read(n) == output.read(n) for n in kept), 'Unexpected payload change'
    print(json.dumps({'unsigned': str(unsigned), 'bytes': unsigned.stat().st_size, 'changed': changes, 'unchangedEntries': len(kept)}, ensure_ascii=False))
