# Models for the web: each GLB in art-src/cars/ and art-src/prakashi/ (Tripo, in Figma Weave), art-src/cafes/ and
# art-src/props/ (TRELLIS.2),
# made from the reference shot beside it, is copied to public/<the same folder>/ with its textures cut down (base
# colour 2048 px, metal/roughness and normals 1024 px, all JPEG). A car's reference shot becomes its garage thumbnail;
# cafés and props are then packed by gltfpack (meshopt, quantized; the loader in src/props.ts unpacks them), some
# simplified too. Run: python3 art-src/cars/process.py [folder ...]
import io
import json
import struct
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
SIZES = {'baseColorTexture': 2048}  # every other texture: 1024
SIMPLIFY = {'pump': 0.25, 'palace': 0.12, 'shikhara': 0.6}  # triangles kept: four pumps at every station, ~140 palaces on the ghats


def textures_by_role(gltf):
    """Image index → the largest size any material wants it at."""
    sizes = {}
    for m in gltf['materials']:
        roles = {**m.get('pbrMetallicRoughness', {}), **{k: v for k, v in m.items() if k.endswith('Texture')}}
        for role, ref in roles.items():
            if isinstance(ref, dict) and 'index' in ref:
                image = gltf['textures'][ref['index']]['source']
                sizes[image] = max(sizes.get(image, 0), SIZES.get(role, 1024))
    return sizes


def process(src: Path, dst: Path):
    data = src.read_bytes()
    json_len = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    blob = data[bin_start:bin_start + struct.unpack_from('<I', data, 20 + json_len)[0]]
    views = [blob[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in gltf['bufferViews']]
    for t in gltf['textures']:  # WebP sources (TRELLIS.2) become JPEG below
        if 'EXT_texture_webp' in t.get('extensions', {}):
            t['source'] = t.pop('extensions')['EXT_texture_webp']['source']
    for key in ('extensionsUsed', 'extensionsRequired'):
        rest = [e for e in gltf.pop(key, []) if e != 'EXT_texture_webp']
        if rest:
            gltf[key] = rest
    for i, size in textures_by_role(gltf).items():
        image = gltf['images'][i]
        picture = Image.open(io.BytesIO(views[image['bufferView']])).convert('RGB')
        picture = picture.resize((size, size), Image.LANCZOS)
        out = io.BytesIO()
        picture.save(out, 'JPEG', quality=88, optimize=True)
        views[image['bufferView']] = out.getvalue()
        image['mimeType'] = 'image/jpeg'
    # Repack the binary chunk, every view on a 4-byte boundary.
    packed = bytearray()
    for view, bytes_ in zip(gltf['bufferViews'], views):
        packed += b'\0' * (-len(packed) % 4)
        view['byteOffset'] = len(packed)
        view['byteLength'] = len(bytes_)
        packed += bytes_
    packed += b'\0' * (-len(packed) % 4)
    gltf['buffers'] = [{'byteLength': len(packed)}]
    text = json.dumps(gltf, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    total = 12 + 8 + len(text) + 8 + len(packed)
    dst.write_bytes(struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(text), 0x4E4F534A) + text + struct.pack('<II', len(packed), 0x004E4942) + packed)
    print(f'{dst.name}: {len(data) / 1e6:.1f} MB → {total / 1e6:.1f} MB')


for kind in sys.argv[1:] or ('cars', 'cafes', 'props', 'prakashi'):  # or just the folders named
    out = HERE.parent.parent / 'public' / kind
    out.mkdir(parents=True, exist_ok=True)
    for src in sorted((HERE.parent / kind).glob('*.glb')):
        process(src, out / src.name)
        if kind == 'cars':
            shot = Image.open(src.with_suffix('.jpg')).convert('RGB')
            shot.thumbnail((480, 320), Image.LANCZOS)
            shot.save(out / f'{src.stem}.jpg', 'JPEG', quality=84, optimize=True)
        else:  # float UVs, so the maps need no texture transform
            simplify = ['-si', str(SIMPLIFY[src.stem])] if src.stem in SIMPLIFY else []
            subprocess.run(['npx', '-y', 'gltfpack@1.3.0', '-i', out / src.name, '-o', out / src.name, '-cc', '-vtf', *simplify], check=True, capture_output=True)
            print(f'  packed: {(out / src.name).stat().st_size / 1e6:.1f} MB')
