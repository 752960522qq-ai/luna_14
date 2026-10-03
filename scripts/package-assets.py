"""Package updated web assets into an unchanged, verified Android native shell.

Usage: python3 scripts/package-assets.py BASE.apk OUTPUT.apk BASE_SHA256
Align and sign the resulting unsigned APK with Android build tools.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]


def manifest_version(data, version):
    assert data[:2] == b'\x03\x00', 'Expected Android binary manifest'
    out = bytearray(data)
    strings = None
    matches = []
    pos = 8
    while pos < len(data):
        kind, header, size = struct.unpack_from('<HHI', data, pos)
        assert size >= header >= 8 and pos + size <= len(data)
        if kind == 1:
            count = struct.unpack_from('<I', data, pos + 8)[0]
            flags = struct.unpack_from('<I', data, pos + 16)[0]
            start = struct.unpack_from('<I', data, pos + 20)[0]
            strings = []
            for i in range(count):
                at = pos + start + struct.unpack_from('<I', data, pos + header + i * 4)[0]
                if flags & 0x100:
                    # UTF-8 pools contain a character count and a byte count.
                    if data[at] & 0x80:
                        at += 2
                    else:
                        at += 1
                    length = data[at]
                    at += 1
                    if length & 0x80:
                        length = ((length & 0x7f) << 8) | data[at]
                        at += 1
                    strings.append(data[at:at + length].decode('utf-8'))
                else:
                    length = struct.unpack_from('<H', data, at)[0]
                    at += 2
                    if length & 0x8000:
                        length = ((length & 0x7fff) << 16) | struct.unpack_from('<H', data, at)[0]
                        at += 2
                    strings.append(data[at:at + length * 2].decode('utf-16-le'))
        elif kind == 0x102:
            ext = pos + header
            name = struct.unpack_from('<I', data, ext + 4)[0]
            attr_start, attr_size, attr_count = struct.unpack_from('<HHH', data, ext + 8)
            if strings[name] == 'manifest':
                for i in range(attr_count):
                    at = ext + attr_start + i * attr_size
                    if strings[struct.unpack_from('<I', data, at + 4)[0]] == 'versionCode':
                        assert data[at + 15] == 0x10, 'versionCode must be an integer'
                        assert struct.unpack_from('<I', data, at + 16)[0] == 21, 'Expected the v21 native shell'
                        struct.pack_into('<I', out, at + 16, version)
                        matches.append(at)
        pos += size
    assert pos == len(data) and len(matches) == 1
    return bytes(out)


def main(base, output, sha):
    assert hashlib.sha256(base.read_bytes()).hexdigest() == sha, 'Base APK digest mismatch'
    files = {p.relative_to(ROOT / 'app/src/main').as_posix(): p for p in (ROOT / 'app/src/main/assets').rglob('*') if p.is_file()}
    changed, retained = [], []
    with ZipFile(base) as source, ZipFile(output, 'w') as target:
        assert source.testzip() is None
        for info in source.infolist():
            name = info.filename
            if name.startswith('META-INF/') and (name == 'META-INF/MANIFEST.MF' or name.endswith(('.SF', '.RSA', '.DSA', '.EC'))):
                continue
            data = source.read(name)
            if name == 'AndroidManifest.xml':
                data = manifest_version(data, 22)
                changed.append(name)
            elif name in files:
                new = files.pop(name).read_bytes()
                if data != new:
                    changed.append(name)
                else:
                    retained.append(name)
                data = new
            else:
                retained.append(name)
            target.writestr(info, data)
        added = list(files)
        for name, path in files.items():
            target.write(path, name, compress_type=ZIP_DEFLATED)
    with ZipFile(base) as source, ZipFile(output) as target:
        assert target.testzip() is None
        for name in retained:
            assert target.read(name) == source.read(name), name
        assert target.getinfo('resources.arsc').compress_type == 0
        for path in (ROOT / 'app/src/main/assets').rglob('*'):
            if path.is_file():
                assert target.read(path.relative_to(ROOT / 'app/src/main').as_posix()) == path.read_bytes()
    report = {'result': 'passed', 'baseSha256': sha, 'changed': changed, 'added': added,
              'retainedPayloadCount': len(retained), 'allPackagedAssetsMatchSource': True,
              'unchangedNativeClassesAndResources': True, 'unsignedBytes': output.stat().st_size}
    (ROOT / 'validation/package-v22.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
