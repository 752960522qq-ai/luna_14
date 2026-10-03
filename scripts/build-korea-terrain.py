"""Build mobile terrain from four supplied GLBs; Python + NumPy + Pillow.

Usage: python3 scripts/build-korea-terrain.py tile3.glb tile4.glb tile5.glb tile6.glb
The source geometry/UVs are read directly and normalized to Y-up world axes.
Shared edges and normals are welded; one periodic atlas retains real edge textures.
"""
import hashlib
import io
import json
import pathlib
import struct
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'app/src/main/assets'
FLOOR_Y = -90.0
PERIOD = 254


class GLB:
    def __init__(self):
        self.binary = bytearray()
        self.doc = {'asset': {'version': '2.0', 'generator': 'Silverwing terrain builder v22'},
                    'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                    'materials': [], 'accessors': [], 'bufferViews': [], 'buffers': []}

    def view(self, data, target=None):
        self.binary.extend(b'\0' * (-len(self.binary) % 4))
        v = {'buffer': 0, 'byteOffset': len(self.binary), 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.binary.extend(data)
        self.doc['bufferViews'].append(v)
        return len(self.doc['bufferViews']) - 1

    def array(self, values, kind, component=5126):
        values = np.asarray(values, dtype='<f4' if component == 5126 else '<u4')
        accessor = {'bufferView': self.view(values.tobytes(), 34963 if kind == 'SCALAR' else 34962),
                    'componentType': component, 'count': len(values), 'type': kind}
        if component == 5126:
            accessor.update(min=values.min(axis=0).tolist(), max=values.max(axis=0).tolist())
        self.doc['accessors'].append(accessor)
        return len(self.doc['accessors']) - 1

    def material(self, image=None):
        m = {'doubleSided': False, 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': .94}}
        if image is not None:
            self.doc.setdefault('images', []).append({'mimeType': 'image/jpeg', 'bufferView': self.view(image)})
            self.doc.setdefault('samplers', [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}])
            textures = self.doc.setdefault('textures', [])
            textures.append({'sampler': 0, 'source': len(self.doc['images']) - 1})
            m['pbrMetallicRoughness']['baseColorTexture'] = {'index': len(textures) - 1}
        self.doc['materials'].append(m)
        return len(self.doc['materials']) - 1

    def mesh(self, name, positions, indices, material, uv=None, colors=None, extras=None, shared_normals=None):
        positions = np.asarray(positions, dtype=np.float32)
        indices = np.asarray(indices, dtype=np.uint32).reshape(-1, 3)
        face = np.cross(positions[indices[:, 1]] - positions[indices[:, 0]], positions[indices[:, 2]] - positions[indices[:, 0]])
        normals = np.zeros_like(positions)
        for k in range(3):
            np.add.at(normals, indices[:, k], face)
        normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-10)
        if shared_normals is not None:
            normals = shared_normals
        attrs = {'POSITION': self.array(positions, 'VEC3'), 'NORMAL': self.array(normals, 'VEC3')}
        if uv is not None:
            attrs['TEXCOORD_0'] = self.array(uv, 'VEC2')
        if colors is not None:
            attrs['COLOR_0'] = self.array(colors, 'VEC3')
        prim = {'attributes': attrs, 'indices': self.array(indices.reshape(-1), 'SCALAR', 5125), 'material': material}
        self.doc['meshes'].append({'name': name, 'primitives': [prim]})
        self.doc['nodes'].append({'name': name, 'mesh': len(self.doc['meshes']) - 1, 'extras': extras or {}})
        self.doc['scenes'][0]['nodes'].append(len(self.doc['nodes']) - 1)

    def save(self, path):
        self.doc['buffers'] = [{'byteLength': len(self.binary)}]
        data = json.dumps(self.doc, separators=(',', ':')).encode()
        data += b' ' * (-len(data) % 4)
        self.binary.extend(b'\0' * (-len(self.binary) % 4))
        out = struct.pack('<III', 0x46546c67, 2, 28 + len(data) + len(self.binary))
        out += struct.pack('<II', len(data), 0x4e4f534a) + data
        out += struct.pack('<II', len(self.binary), 0x004e4942) + self.binary
        path.write_bytes(out)


def source(path):
    data = path.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + size])
    start = 28 + size
    def access(index):
        a = doc['accessors'][index]
        v = doc['bufferViews'][a['bufferView']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        dtype = {5126: '<f4', 5125: '<u4', 5123: '<u2'}[a['componentType']]
        return np.frombuffer(data, dtype=dtype, count=a['count'] * width,
                             offset=start + v.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], width).copy()
    primitive = doc['meshes'][0]['primitives'][0]
    raw = access(primitive['attributes']['POSITION'])
    uv = access(primitive['attributes']['TEXCOORD_0'])
    lo, hi = raw.min(axis=0), raw.max(axis=0)
    width, depth = hi[0] - lo[0], hi[1] - lo[1]
    assert width > 0 and depth > 0
    ix = np.rint((raw[:, 0] - lo[0]) / width * 127).astype(int)
    iz = np.rint((hi[1] - raw[:, 1]) / depth * 127).astype(int)
    height = np.empty((128, 128), dtype=np.float32)
    height[iz, ix] = (raw[:, 2] - lo[2]) * (300 / width)
    uv_grid = np.empty((128, 128, 2), dtype=np.float32)
    uv_grid[iz, ix] = uv
    image_index = doc['textures'][doc['materials'][primitive['material']]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
    bv = doc['bufferViews'][doc['images'][image_index]['bufferView']]
    pixels = np.asarray(Image.open(io.BytesIO(data[start + bv.get('byteOffset', 0):start + bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGB'))
    return height, uv_grid, pixels


def bilinear(grid, x, z):
    x = np.clip(x, 0, grid.shape[1] - 1)
    z = np.clip(z, 0, grid.shape[0] - 1)
    i = np.minimum(x.astype(int), grid.shape[1] - 2)
    j = np.minimum(z.astype(int), grid.shape[0] - 2)
    fx, fz = x - i, z - j
    if grid.ndim == 3:
        fx, fz = fx[..., None], fz[..., None]
    return (grid[j, i] * (1 - fx) + grid[j, i + 1] * fx) * (1 - fz) + (grid[j + 1, i] * (1 - fx) + grid[j + 1, i + 1] * fx) * fz


def bake_texture(uv_grid, pixels):
    n = 2048
    out = np.empty((n, n, 3), dtype=np.uint8)
    x = np.arange(n, dtype=np.float32)[None, :] / (n - 1)
    for row in range(0, n, 64):
        z = np.arange(row, min(n, row + 64), dtype=np.float32)[:, None] / (n - 1)
        uv = bilinear(uv_grid, np.broadcast_to(x * 127, (len(z), n)), np.broadcast_to(z * 127, (len(z), n)))
        rgb = bilinear(pixels, uv[..., 0] * (pixels.shape[1] - 1), uv[..., 1] * (pixels.shape[0] - 1))
        out[row:row + len(z)] = np.clip(rgb, 0, 255).astype(np.uint8)
    return out



def periodic_atlas(images):
    atlas = np.concatenate([np.concatenate(images[:2], axis=1), np.concatenate(images[2:], axis=1)], axis=0)
    # Blend only 18 m, using the real adjoining textures. No fixed green color.
    for axis in [1, 0]:
        for seam in [0, 2048]:
            for d in range(12):
                a, b = (seam - d - 1) % 4096, (seam + d) % 4096
                left, right = np.take(atlas, a, axis=axis).astype(float), np.take(atlas, b, axis=axis).astype(float)
                mean = (left + right) * .5
                w = 1 - d / 12; w = w * w * (3 - 2 * w)
                l, r = np.rint(left + (mean - left) * w), np.rint(right + (mean - right) * w)
                if axis == 1: atlas[:, a], atlas[:, b] = l, r
                else: atlas[a], atlas[b] = l, r
    for a, b in [(0, -1), (2047, 2048)]:
        assert np.array_equal(atlas[:, a], atlas[:, b])
        assert np.array_equal(atlas[a], atlas[b])
    buf = io.BytesIO(); Image.fromarray(atlas).save(buf, 'JPEG', quality=90, subsampling=0, optimize=True)
    return buf.getvalue()


def welded_field(heights):
    sums, counts = np.zeros((PERIOD, PERIOD)), np.zeros((PERIOD, PERIOD))
    for at, h in enumerate(heights):
        x, z = np.meshgrid((np.arange(128) + (at % 2) * 127) % PERIOD,
                           (np.arange(128) + (at // 2) * 127) % PERIOD)
        np.add.at(sums, (z, x), h); np.add.at(counts, (z, x), 1)
    field = sums / counts
    step = 600 / PERIOD
    dx = (np.roll(field, -1, axis=1) - np.roll(field, 1, axis=1)) / (2 * step)
    dz = (np.roll(field, -1, axis=0) - np.roll(field, 1, axis=0)) / (2 * step)
    normals = np.stack([-dx, np.ones_like(field), -dz], axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    return np.pad(field, ((0, 1), (0, 1)), mode='wrap'), np.pad(normals, ((0, 1), (0, 1), (0, 0)), mode='wrap')


def main(paths):
    if len(paths) != 4: raise SystemExit(__doc__)
    heights, images = [], []
    for path in paths:
        h, uv, pixels = source(path); heights.append(h); images.append(bake_texture(uv, pixels))
        print('Read and measured', path.name, flush=True)
    field, normals = welded_field(heights)
    core = GLB(); material = core.material(periodic_atlas(images))
    indices = []
    for z in range(127):
        for x in range(127):
            a = z * 128 + x; indices.extend([[a, a + 128, a + 1], [a + 1, a + 128, a + 129]])
    report = {'mapMeters': 6000, 'tileMeters': 3000, 'distanceOrigin': 'rectangular combat boundary',
              'outsideHighDetailMeters': [0, 6000], 'outsideLowDetailMeters': [6000, 12000],
              'outsideFogMeters': [12000, 16000], 'floorYUnits': FLOOR_Y, 'bottomPlaneYUnits': -90.15,
              'atlasPixels': [4096, 4096], 'atlasTilePixels': [2048, 2048], 'fixedGreenSeamRemoved': True,
              'tiles': [], 'highDetailCopies': 9, 'highDetailTileCount': 36}
    for at, path in enumerate(paths):
        ox, oz = at % 2 * 127, at // 2 * 127
        x, z = np.meshgrid(np.linspace(-300 + (at % 2) * 300, (at % 2) * 300, 128),
                           np.linspace(-300 + (at // 2) * 300, (at // 2) * 300, 128))
        h = field[oz:oz + 128, ox:ox + 128]
        pos = np.stack([x, h + FLOOR_Y, z], axis=-1).reshape(-1, 3)
        n = normals[oz:oz + 128, ox:ox + 128].reshape(-1, 3)
        uv = np.stack([(x + 300) / 600, (z + 300) / 600], axis=-1).reshape(-1, 2)
        meta = {'source': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'tileMeters': 3000,
                'vertices': len(pos), 'triangles': len(indices), 'maxHeightMetersMSL': float(h.max() * 10),
                'boundingBoxMeters': {'min': (pos.min(axis=0) * 10).tolist(), 'max': (pos.max(axis=0) * 10).tolist()}}
        core.mesh('korea-tile-' + str(at + 1), pos, indices, material, uv, extras=meta, shared_normals=n)
        report['tiles'].append(meta)
    core.doc['extras'] = report; core.save(ASSETS / 'korea-1951-terrain.glb')
    scenery = GLB()
    # Preserve every high-detail boundary vertex on the first coarse ring.
    t = np.concatenate([np.linspace(-900 + i * 300, -600 + i * 300, 128)[:-1] for i in range(6)])
    perimeter = np.concatenate([np.c_[t, np.full(len(t), -900)], np.c_[np.full(len(t), 900), t],
                                np.c_[-t, np.full(len(t), 900)], np.c_[np.full(len(t), -900), -t]])
    for label, shells in [('korea-outside-low-6-12km', list(range(900, 1501, 100))),
                          ('korea-outside-fog-12-16km', [1500, 1600, 1800, 1900])]:
        p = np.concatenate([perimeter * radius / 900 for radius in shells])
        xz = np.mod(p + 300, 600) / 600 * PERIOD
        h = bilinear(field, xz[:, 0], xz[:, 1])
        if 'fog' in label: h *= 1 - np.clip((np.max(np.abs(p), axis=1) - 1500) / 400, 0, 1)
        pos = np.c_[p[:, 0], h + FLOOR_Y, p[:, 1]]
        tris = []; count = len(perimeter)
        for ring in range(len(shells) - 1):
            for j in range(count):
                a, b, c, d = ring * count + j, ring * count + (j + 1) % count, (ring + 1) * count + j, (ring + 1) * count + (j + 1) % count
                tris.extend([[a, c, b], [b, c, d]])
        tris = np.asarray(tris); faces = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
        down = faces[:, 1] < 0; tris[down] = tris[down][:, [0, 2, 1]]
        scenery.mesh(label, pos, tris, scenery.material(), uv=(p + 300) / 600, extras={'visualOnly': True, 'useCoreAtlas': True})
        report[label] = {'vertices': len(pos), 'triangles': len(tris), 'outsideMeters': [(shells[0] - 300) * 10, (shells[-1] - 300) * 10]}
    scenery.save(ASSETS / 'korea-1951-distance.glb')
    report['coreBytes'] = (ASSETS / 'korea-1951-terrain.glb').stat().st_size
    report['distanceBytes'] = (ASSETS / 'korea-1951-distance.glb').stat().st_size
    (ROOT / 'data/korea-terrain.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__': main([pathlib.Path(p) for p in sys.argv[1:]])
