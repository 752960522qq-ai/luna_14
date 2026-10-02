"""Normalize the uploaded MiG-3 GLB without changing its meshes or textures."""
from pathlib import Path
import hashlib, json, struct

root = Path(__file__).resolve().parent
source = (root / 'baseline/mig3-upload.glb').read_bytes()
assert hashlib.sha256(source).hexdigest() == 'daceecb29a4a87ae636e3e4c4a0f128a8025acd4a93dd7371942dfcd0ff56133'
assert struct.unpack_from('<III', source) == (0x46546c67, 2, len(source))
size, kind = struct.unpack_from('<II', source, 12)
assert kind == 0x4e4f534a
gltf = json.loads(source[20:20+size])
binary_chunk = source[20+size:]
binary_size, binary_kind = struct.unpack_from('<II', binary_chunk)
assert binary_kind == 0x004e4942 and len(binary_chunk) == binary_size + 8
binary = binary_chunk[8:]
assert not gltf.get('extensionsRequired') and not gltf.get('extensionsUsed')
assert all('pbrMetallicRoughness' in m for m in gltf['materials'])
assert all('bufferView' in image for image in gltf['images'])
for view in gltf['bufferViews']:
    assert view.get('buffer', 0) == 0
    assert 0 <= view.get('byteOffset', 0) <= view.get('byteOffset', 0) + view['byteLength'] <= len(binary)

# Source node 1 rotates X by +90 degrees; replace the arbitrary export yaw
# with X -90 degrees so the authored nose is -Z and the fin is +Y.
gltf['nodes'][0]['matrix'] = [1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1]
identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
def multiply(a,b):
    return [sum(a[k*4+r]*b[c*4+k] for k in range(4)) for c in range(4) for r in range(4)]
def transformed(m,p):
    return [sum(m[c*4+r]*p[c] for c in range(4)) for r in range(3)]
low, high = [float('inf')]*3, [-float('inf')]*3
def visit(i,parent):
    node = gltf['nodes'][i]
    world = multiply(parent,node.get('matrix',identity))
    if 'mesh' in node:
        for primitive in gltf['meshes'][node['mesh']]['primitives']:
            accessor = gltf['accessors'][primitive['attributes']['POSITION']]
            assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
            view = gltf['bufferViews'][accessor['bufferView']]
            offset = view.get('byteOffset',0)+accessor.get('byteOffset',0)
            stride = view.get('byteStride',12)
            for j in range(accessor['count']):
                point = transformed(world,(*struct.unpack_from('<fff',binary,offset+j*stride),1))
                for axis in range(3):
                    low[axis] = min(low[axis],point[axis]); high[axis] = max(high[axis],point[axis])
    for child in node.get('children',[]): visit(child,world)
visit(0,identity)
length = high[2]-low[2]
assert 8.2 < length < 8.3
scale = 8.25/length
center = [(a+b)/2 for a,b in zip(low,high)]

# The three Line meshes at the spinner are the authored propeller blades.
# Preserve their world transforms while adding an explicit animation pivot.
blade_nodes = [42,46,120]
assert [gltf['nodes'][i]['name'] for i in blade_nodes] == ['Line12','Line11','Line08']
gltf['nodes'][1]['children'] = [i for i in gltf['nodes'][1]['children'] if i not in blade_nodes]
blades_index = len(gltf['nodes'])
gltf['nodes'].append({'name':'PropellerBlades','children':blade_nodes,'translation':[0,0,3.55]})
pivot_index = len(gltf['nodes'])
gltf['nodes'].append({'name':'PropellerPivot','children':[blades_index],'translation':[0,0,-3.55]})
# Node 0 and node 1 cancel exactly; place the pivot beside node 0.
wrapper_index = len(gltf['nodes'])
gltf['nodes'].append({'name':'MiG3_8_25m_YUp_NoseMinusZ','children':[0,pivot_index],
    'scale':[scale]*3,'translation':[-x*scale for x in center],
    'extras':{'lengthMeters':8.25,'noseAxis':'-Z','upAxis':'+Y','uniformScale':scale}})
gltf['scenes'][gltf.get('scene',0)]['nodes'] = [wrapper_index]
payload = json.dumps(gltf,ensure_ascii=False,separators=(',',':')).encode()
payload += b' ' * (-len(payload)%4)
output = struct.pack('<III',0x46546c67,2,12+8+len(payload)+len(binary_chunk)) + struct.pack('<II',len(payload),0x4e4f534a) + payload + binary_chunk
destination = root/'app/src/main/assets/mig3.glb'
destination.write_bytes(output)
report = {'result':'passed','sourceSha256':hashlib.sha256(source).hexdigest(),
    'outputSha256':hashlib.sha256(output).hexdigest(),'lengthMeters':8.25,
    'sizeMeters':[(b-a)*scale for a,b in zip(low,high)],'axes':{'nose':'-Z','up':'+Y'},
    'uniformScale':scale,'materials':len(gltf['materials']),
    'texturedMaterials':sum('baseColorTexture' in m['pbrMetallicRoughness'] for m in gltf['materials']),
    'embeddedImages':len(gltf['images']),'allMaterialsMetallicRoughness':True,
    'extensionsRequired':[],'binaryMeshesAndTexturesUnchanged':True,
    'propellerBladeNodes':blade_nodes,'bytes':len(output)}
(root/'validation/mig3-model-v15.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
