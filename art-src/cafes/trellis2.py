# Image → GLB through Microsoft's TRELLIS.2 Space on Hugging Face (free ZeroGPU quota; an HF token buys more).
# Needs Python 3.10+ with gradio_client (python3.12 -m venv venv && venv/bin/pip install gradio_client); then
# set -a; . ./.env; set +a; venv/bin/python art-src/cafes/trellis2.py art-src/cafes/coast.jpg art-src/cafes/coast.glb
import os
import shutil
import sys
import time

from gradio_client import Client, handle_file

src, out = sys.argv[1], sys.argv[2]
faces = int(sys.argv[3]) if len(sys.argv) > 3 else 150000
t = time.time()
c = Client('microsoft/TRELLIS.2', token=os.environ.get('HF_TOKEN'))
c.predict(api_name='/start_session')
image = c.predict(input=handle_file(src), api_name='/preprocess_image')
print('preprocessed', image, round(time.time() - t), 's', flush=True)
c.predict(image=handle_file(image if isinstance(image, str) else image['path']), seed=1, resolution='1024', api_name='/image_to_3d')
print('generated', round(time.time() - t), 's', flush=True)
glb, _ = c.predict(decimation_target=faces, texture_size=2048, api_name='/extract_glb')
shutil.copy(glb, out)
print('saved', out, round(time.time() - t), 's')
