# Image → GLB through Tripo's own API (v3.1, detailed geometry and textures): the model the coupé and the roadster came
# from in Figma Weave. Needs TRIPO_API_KEY in .env (from platform.tripo3d.ai, API Keys). Standard library only.
#   set -a; . ./.env; set +a; python3 art-src/cars/tripo.py art-src/cars/stealth.jpg art-src/cars/stealth.glb
#   set -a; . ./.env; set +a; python3 art-src/cars/tripo.py --balance
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

API = 'https://openapi.tripo3d.ai/v3'
VERSION = 'v3.1-20260211'


def call(method, path, body=None, kind='application/json'):
    headers = {'Authorization': f"Bearer {os.environ['TRIPO_API_KEY']}", 'User-Agent': 'puzzlecafe-art/1.0'}
    if body is not None:
        headers['Content-Type'] = kind
    request = urllib.request.Request(API + path, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        sys.exit(f'{method} {path}: HTTP {e.code} {e.read().decode()[:400]}')


def upload(path):
    boundary = uuid.uuid4().hex
    head = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{os.path.basename(path)}"\r\nContent-Type: image/jpeg\r\n\r\n'
    body = head.encode() + open(path, 'rb').read() + f'\r\n--{boundary}--\r\n'.encode()
    return call('POST', '/files', body, f'multipart/form-data; boundary={boundary}')['data']['file_token']


if sys.argv[1] == '--balance':
    print(call('GET', '/account/balance')['data'])
    sys.exit()
src, out = sys.argv[1], sys.argv[2]
t = time.time()
token = upload(src)
spec = {'model_version': VERSION, 'file': {'type': 'jpg', 'file_token': token}, 'texture': True, 'pbr': True, 'texture_quality': 'detailed', 'geometry_quality': 'detailed'}
created = call('POST', '/generation/image-to-model', json.dumps(spec).encode())
task = created.get('data', {}).get('task_id') or sys.exit(f'no task id: {created}')
print('task', task, flush=True)
while True:
    time.sleep(5)
    data = call('GET', f'/tasks/{task}')['data']
    if data['status'] in ('queued', 'running'):
        continue
    if data['status'] != 'success':
        sys.exit(f"{data['status']}: {data.get('error_code')} {data.get('error_message')}")
    urllib.request.urlretrieve(data['output']['model_url'], out)
    print('saved', out, round(time.time() - t), 's, credits', data.get('credits_consumed'))
    break
