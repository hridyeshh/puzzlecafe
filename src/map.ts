// The map (M): sea, land, roads, paperboxd cafés and petrol stations around the car. Canvas 2D; drag pans, wheel zooms.
import { COAST_C } from './world/fields.ts';
import type { World } from './world/world.ts';

const ZOOMS = [3, 6, 12, 24]; // metres per screen pixel
const DEEP = [28, 64, 92];
const SHALLOW = [74, 140, 160];
const SAND = [214, 196, 152];
const LOW = [130, 160, 96];
const HIGH = [176, 168, 120];
const mixRGB = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

export function createMap(world: World) {
  const canvas = document.body.appendChild(document.createElement('canvas'));
  canvas.id = 'map';
  canvas.hidden = true;
  const g = canvas.getContext('2d')!;
  const base = document.createElement('canvas'); // land, roads and places; redrawn after a pan or zoom
  let zoom = 1;
  let cx = 0; // world point at the centre of the screen
  let cz = 0;
  let view = { x0: 0, z0: 0, m: 1 }; // what `base` shows: top-left world point, metres per device pixel
  let car = { x: 0, z: 0, yaw: 0 };
  let drag: { px: number; py: number; dx: number; dy: number } | null = null;

  function render() {
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round(innerWidth * dpr);
    const h = Math.round(innerHeight * dpr);
    canvas.width = base.width = w;
    canvas.height = base.height = h;
    const m = ZOOMS[zoom] / dpr;
    const x0 = cx - (w / 2) * m;
    const z0 = cz - (h / 2) * m;
    const b = base.getContext('2d')!;

    // Land and sea, sampled every 4 pixels and scaled up.
    const S = 4;
    const iw = Math.ceil(w / S);
    const ih = Math.ceil(h / S);
    const small = document.createElement('canvas');
    small.width = iw;
    small.height = ih;
    const sg = small.getContext('2d')!;
    const img = sg.createImageData(iw, ih);
    for (let j = 0; j < ih; j++) {
      for (let i = 0; i < iw; i++) {
        const c = world.fields.continent(x0 + (i + 0.5) * S * m, z0 + (j + 0.5) * S * m);
        const rgb = c < 0 ? mixRGB(SHALLOW, DEEP, Math.min(1, -c * 6)) : c < COAST_C * 0.4 ? SAND : mixRGB(LOW, HIGH, Math.min(1, c * 1.5));
        img.data.set([rgb[0], rgb[1], rgb[2], 255], (j * iw + i) * 4);
      }
    }
    sg.putImageData(img, 0, 0);
    b.imageSmoothingEnabled = true;
    b.drawImage(small, 0, 0, iw * S, ih * S);

    // Roads: inland ones first, the coast road on top.
    const step = Math.max(8, Math.round((ZOOMS[zoom] * 2.5) / 8) * 8);
    const { roads, pois } = world.mapData(x0, z0, x0 + w * m, z0 + h * m, step);
    b.lineCap = b.lineJoin = 'round';
    for (const coast of [false, true]) {
      b.strokeStyle = coast ? '#fff6e2' : '#eee8da';
      b.lineWidth = (coast ? 3.4 : 2.2) * dpr;
      b.beginPath();
      for (const r of roads) {
        if (r.coast !== coast) continue;
        r.x.forEach((x, k) => (k ? b.lineTo : b.moveTo).call(b, (x - x0) / m, (r.z[k] - z0) / m));
      }
      b.stroke();
    }

    // Places: paperboxd cafés and petrol stations.
    b.textAlign = 'center';
    b.textBaseline = 'middle';
    for (const p of pois) {
      if (p.kind === 'hoarding') continue;
      const cafe = p.kind === 'cafe';
      badge(b, (p.x - x0) / m, (p.z - z0) / m, cafe ? '#111111' : '#1f8a83', cafe ? 'pb' : 'F', dpr);
    }
    b.fillStyle = 'rgba(12, 14, 18, 0.6)';
    b.beginPath();
    b.roundRect(8 * dpr, 10 * dpr, 150 * dpr, 66 * dpr, 12 * dpr);
    b.fill();
    badge(b, 24 * dpr, 28 * dpr, '#111111', 'pb', dpr);
    badge(b, 24 * dpr, 58 * dpr, '#1f8a83', 'F', dpr);
    b.textAlign = 'left';
    b.fillStyle = '#ffffff';
    b.font = `600 ${13 * dpr}px system-ui, sans-serif`;
    b.fillText('paperboxd café', 42 * dpr, 28 * dpr);
    b.fillText('fuel', 42 * dpr, 58 * dpr);
    b.font = `${12 * dpr}px system-ui, sans-serif`;
    b.fillText('drag to move · scroll to zoom · M to close', 14 * dpr, h - 18 * dpr);
    view = { x0, z0, m };
    draw();
  }

  function badge(b: CanvasRenderingContext2D, x: number, y: number, fill: string, label: string, dpr: number) {
    b.fillStyle = fill;
    b.strokeStyle = '#ffffff';
    b.lineWidth = 2 * dpr;
    b.beginPath();
    b.arc(x, y, 10 * dpr, 0, Math.PI * 2);
    b.fill();
    b.stroke();
    b.fillStyle = '#ffffff';
    b.font = `700 ${9 * dpr}px system-ui, sans-serif`;
    b.fillText(label, x, y + 0.5 * dpr);
  }

  // The base image (shifted while dragging) and the car on top.
  function draw() {
    const dpr = Math.min(devicePixelRatio, 2);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(base, drag ? drag.dx * dpr : 0, drag ? drag.dy * dpr : 0);
    const x = (car.x - view.x0) / view.m + (drag ? drag.dx * dpr : 0);
    const y = (car.z - view.z0) / view.m + (drag ? drag.dy * dpr : 0);
    g.save();
    g.translate(x, y);
    g.rotate(Math.atan2(Math.cos(car.yaw), Math.sin(car.yaw))); // heading (sin, cos) in screen x, y
    g.fillStyle = '#e76f51';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.moveTo(12 * dpr, 0);
    g.lineTo(-8 * dpr, 7 * dpr);
    g.lineTo(-4 * dpr, 0);
    g.lineTo(-8 * dpr, -7 * dpr);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  canvas.addEventListener('pointerdown', (e) => {
    drag = { px: e.clientX, py: e.clientY, dx: 0, dy: 0 };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.px;
    drag.dy = e.clientY - drag.py;
    draw();
  });
  canvas.addEventListener('pointerup', () => {
    if (!drag) return;
    cx -= drag.dx * ZOOMS[zoom];
    cz -= drag.dy * ZOOMS[zoom];
    drag = null;
    render();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const next = Math.max(0, Math.min(ZOOMS.length - 1, zoom + Math.sign(e.deltaY)));
    if (next !== zoom) {
      zoom = next;
      render();
    }
  });

  return {
    get open() {
      return !canvas.hidden;
    },
    /** Open centred on the car at world (x, z), or close. */
    toggle(x: number, z: number, yaw: number) {
      canvas.hidden = !canvas.hidden;
      if (canvas.hidden) return;
      car = { x, z, yaw };
      cx = x;
      cz = z;
      render();
    },
    close() {
      canvas.hidden = true;
    },
    /** Move the car marker while the map is open. */
    follow(x: number, z: number, yaw: number) {
      car = { x, z, yaw };
      draw();
    },
  };
}
