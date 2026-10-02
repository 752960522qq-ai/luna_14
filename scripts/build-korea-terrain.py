"""Build mobile terrain from four supplied GLBs; Python + NumPy + Pillow.

Usage: python3 scripts/build-korea-terrain.py tile3.glb tile4.glb tile5.glb tile6.glb
The source geometry/UVs are read directly and normalized to Y-up world axes.
Only the outer 100 m of each 3 km tile is feathered for continuous joins.
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
SEAM_COLOR = np.array([98, 115, 85], dtype=np.float32)


class GLB:
    def __init__(self):
        self.binary = bytearray()
        self.doc = {'asset': {'version': '2.0', 'generator': 'Silverwing terrain builder v21'},
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
            self.doc.setdefault('samplers', [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}])
            textures = self.doc.setdefault('textures', [])
            textures.append({'sampler': 0, 'source': len(self.doc['images']) - 1})
            m['pbrMetallicRoughness']['baseColorTexture'] = {'index': len(textures) - 1}
        self.doc['materials'].append(m)
        return len(self.doc['materials']) - 1

    def mesh(self, name, positions, indices, material, uv=None, colors=None, extras=None):
        positions = np.asarray(positions, dtype=np.float32)
        indices = np.asarray(indices, dtype=np.uint32).reshape(-1, 3)
        face = np.cross(positions[indices[:, 1]] - positions[indices[:, 0]], positions[indices[:, 2]] - positions[indices[:, 0]])
        normals = np.zeros_like(positions)
        for k in range(3):
            np.add.at(normals, indices[:, k], face)
        normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-10)
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
    ix = np.rint((raw[:, 0] + 1) * 63.5).astype(int)
    iz = np.rint((1 - raw[:, 1]) * 63.5).astype(int)
    height = np.empty((128, 128), dtype=np.float32)
    height[iz, ix] = raw[:, 2] * 150
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
        edge = np.minimum(np.minimum(x, 1 - x), np.minimum(z, 1 - z))
        blend = np.clip(edge * 3000 / 100, 0, 1)
        blend = (blend * blend * (3 - 2 * blend))[..., None]
        out[row:row + len(z)] = np.clip(SEAM_COLOR + (rgb - SEAM_COLOR) * blend, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out).save(buf, 'JPEG', quality=87, subsampling=0, optimize=True)
    return buf.getvalue()


def main(paths):
    if len(paths) != 4:
        raise SystemExit(__doc__)
    core = GLB()
    report = {'mapMeters': 6000, 'tileMeters': 3000, 'fogStartMeters': 5000, 'sceneryMeters': [12000, 20000], 'tiles': []}
    heights = []
    indices = []
    for z in range(127):
        for x in range(127):
            a = z * 128 + x
            indices.extend([[a, a + 128, a + 1], [a + 1, a + 128, a + 129]])
    coords = np.linspace(0, 1, 128)
    x, z = np.meshgrid(coords, coords)
    edge = np.minimum(np.minimum(x, 1 - x), np.minimum(z, 1 - z))
    blend = np.clip(edge * 3000 / 100, 0, 1)
    blend = blend * blend * (3 - 2 * blend)
    for at, path in enumerate(paths):
        h, uv, pixels = source(path)
        h = h * blend
        heights.append(h)
        cx, cz = [(-150, -150), (150, -150), (-150, 150), (150, 150)][at]
        pos = np.stack([(x - .5) * 300 + cx, h - 90, (z - .5) * 300 + cz], axis=-1).reshape(-1, 3)
        meta = {'source': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'tileMeters': 3000}
        core.mesh('korea-tile-' + str(at + 1), pos, indices, core.material(bake_texture(uv, pixels)), np.stack([x, z], axis=-1).reshape(-1, 2), extras=meta)
        report['tiles'].append({**meta, 'vertices': len(pos), 'triangles': len(indices), 'maxHeightMetersMSL': float(h.max() * 10)})
        print('Built', path.name, flush=True)
    core.doc['extras'] = report
    core.save(ASSETS / 'korea-1951-terrain.glb')
    scenery = GLB()
    # Exact 128-point edges share the core's outer perimeter; concentric rings
    # then transition to a circle at 12 km and a coarse horizon at 20 km.
    t = np.linspace(-300, 300, 128)
    perimeter = np.concatenate([np.c_[t[:-1], np.full(127, -300)], np.c_[np.full(127, 300), t[:-1]],
                                np.c_[t[:0:-1], np.full(127, 300)], np.c_[np.full(127, -300), t[:0:-1]]])
    radii = np.linalg.norm(perimeter, axis=1)
    unit = perimeter / radii[:, None]
    for label, shells in [('korea-distance-medium-3-12km', [radii] + [np.full(508, r) for r in range(480, 1201, 60)]),
                          ('korea-distance-low-12-20km', [np.full(508, r) for r in [1200, 1400, 1600, 1800, 2000]])]:
        p = np.concatenate([unit * r[:, None] for r in shells])
        xz = np.mod(p + 300, 300) / 300 * 127
        h = np.zeros(len(p))
        for i in range(len(p)):
            tile = int((p[i, 0] >= 0) + 2 * (p[i, 1] >= 0))
            h[i] = bilinear(heights[tile], np.array(xz[i, 0]), np.array(xz[i, 1]))
        beyond = np.maximum(np.max(np.abs(p), axis=1) - 300, 0)
        fade = np.clip(beyond / 40, 0, 1)
        fade = fade * fade * (3 - 2 * fade)
        h *= fade * .8
        # Avoid a vertical cut at the outer limit; it vanishes inside the fog.
        h *= np.clip((2000 - np.linalg.norm(p, axis=1)) / 150, 0, 1)
        pos = np.c_[p[:, 0], h - 90, p[:, 1]]
        tris = []
        for r in range(len(shells) - 1):
            for j in range(508):
                a, b, c, d = r * 508 + j, r * 508 + (j + 1) % 508, (r + 1) * 508 + j, (r + 1) * 508 + (j + 1) % 508
                tris.extend([[a, c, b], [b, c, d]])
        # Perimeter winds counterclockwise in X/Z; enforce upward-facing faces.
        tris = np.asarray(tris)
        faces = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
        down = faces[:, 1] < 0
        tris[down] = tris[down][:, [0, 2, 1]]
        color = np.tile(SEAM_COLOR / 255, (len(p), 1))
        color += (np.minimum(h / 90, 1) * fade)[:, None] * np.array([.08, .035, .04])
        # glTF vertex colors are linear, unlike the JPEG base color.
        linear_color = np.where(color <= .04045, color / 12.92, ((color + .055) / 1.055) ** 2.4)
        scenery.mesh(label, pos, tris, scenery.material(), colors=linear_color, extras={'visualOnly': True})
        report[label] = {'vertices': len(pos), 'triangles': len(tris)}
    scenery.save(ASSETS / 'korea-1951-distance.glb')
    report['coreBytes'] = (ASSETS / 'korea-1951-terrain.glb').stat().st_size
    report['distanceBytes'] = (ASSETS / 'korea-1951-distance.glb').stat().st_size
    (ROOT / 'data/korea-terrain.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main([pathlib.Path(p) for p in sys.argv[1:]])
