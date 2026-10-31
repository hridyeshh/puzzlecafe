// Sound, all synthesised: an engine that climbs through gears, wind and tyres with speed, waves near the sea, a nitro
// whoosh, and in chase mode the sirens and the helicopter.
// The graph is built at load, behind the landing page, because starting an AudioContext blocks for ~130 ms; browsers
// only let it play after a gesture, so it resumes on the first key or click.

export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode;
  let engineA: OscillatorNode;
  let engineB: OscillatorNode;
  let engineTone: BiquadFilterNode;
  let engineGain: GainNode;
  let windTone: BiquadFilterNode;
  let windGain: GainNode;
  let waveGain: GainNode;
  let rainGain: GainNode;
  let sweep: OscillatorNode;
  let sirenGain: GainNode;
  let rotorGain: GainNode;
  let nitroGain: GainNode;
  let muted = false;

  function noise(c: AudioContext, brown: boolean) {
    const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = brown ? (last + 0.02 * white) / 1.02 : white; // brown noise is a leaky walk: deep, like surf
      data[i] = brown ? last * 3.5 : white;
    }
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    return source;
  }

  function build() {
    const c = (ctx = new AudioContext());
    master = c.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(c.destination);

    engineA = c.createOscillator();
    engineA.type = 'sawtooth';
    engineB = c.createOscillator();
    engineB.type = 'square';
    engineTone = c.createBiquadFilter();
    engineTone.type = 'lowpass';
    engineGain = c.createGain();
    engineGain.gain.value = 0;
    engineA.connect(engineTone);
    engineB.connect(engineTone);
    engineTone.connect(engineGain).connect(master);
    engineA.start();
    engineB.start();

    windTone = c.createBiquadFilter();
    windTone.type = 'bandpass';
    windTone.Q.value = 0.6;
    windGain = c.createGain();
    windGain.gain.value = 0;
    const white = noise(c, false);
    white.connect(windTone).connect(windGain).connect(master);
    // Rain: the same hiss, high-passed, louder as it rains.
    const rainTone = c.createBiquadFilter();
    rainTone.type = 'highpass';
    rainTone.frequency.value = 1800;
    rainGain = c.createGain();
    rainGain.gain.value = 0;
    white.connect(rainTone).connect(rainGain).connect(master);

    // Waves: brown noise, low-passed, swelling slowly.
    const surf = c.createBiquadFilter();
    surf.type = 'lowpass';
    surf.frequency.value = 500;
    waveGain = c.createGain();
    waveGain.gain.value = 0;
    const swell = c.createGain();
    swell.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.09;
    const depth = c.createGain();
    depth.gain.value = 0.45;
    lfo.connect(depth).connect(swell.gain);
    lfo.start();
    noise(c, true).connect(surf).connect(swell).connect(waveGain).connect(master);

    // Siren: a sawtooth swept up and down by a slow wail, or a fast yelp up close.
    const siren = c.createOscillator();
    siren.type = 'sawtooth';
    siren.frequency.value = 950;
    sweep = c.createOscillator();
    sweep.type = 'triangle';
    sweep.frequency.value = 0.25;
    const range = c.createGain();
    range.gain.value = 380;
    sweep.connect(range).connect(siren.frequency);
    const sirenTone = c.createBiquadFilter();
    sirenTone.type = 'lowpass';
    sirenTone.frequency.value = 2400;
    sirenGain = c.createGain();
    sirenGain.gain.value = 0;
    siren.connect(sirenTone).connect(sirenGain).connect(master);
    siren.start();
    sweep.start();
    // Helicopter: a deep rumble chopped by the blades, 18 times a second.
    const thump = c.createBiquadFilter();
    thump.type = 'lowpass';
    thump.frequency.value = 220;
    const chop = c.createGain();
    chop.gain.value = 0.5;
    const blades = c.createOscillator();
    blades.type = 'square';
    blades.frequency.value = 18;
    const depth2 = c.createGain();
    depth2.gain.value = 0.5;
    blades.connect(depth2).connect(chop.gain);
    blades.start();
    rotorGain = c.createGain();
    rotorGain.gain.value = 0;
    noise(c, true).connect(thump).connect(chop).connect(rotorGain).connect(master);
    // Nitro: a rushing hiss.
    const rush = c.createBiquadFilter();
    rush.type = 'bandpass';
    rush.frequency.value = 900;
    rush.Q.value = 0.8;
    nitroGain = c.createGain();
    nitroGain.gain.value = 0;
    white.connect(rush).connect(nitroGain).connect(master);
  }
  build();
  const resume = () => void ctx?.resume();
  addEventListener('keydown', resume, { once: true });
  addEventListener('pointerdown', resume, { once: true });

  return {
    toggle() {
      muted = !muted;
      if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.1);
    },
    /** `speed` m/s, `throttle` 0–1, `sea` 0–1 how near the water is, `rain` 0–1. */
    update(speed: number, throttle: number, sea: number, rain: number) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const v = Math.abs(speed);
      // Five gears of ~9 m/s: the engine note climbs through each and drops at the shift.
      const gear = Math.min(4, Math.floor(v / 9));
      const rev = (v - gear * 9) / 9;
      const pitch = 38 + rev * 55 + gear * 6;
      engineA.frequency.setTargetAtTime(pitch, t, 0.05);
      engineB.frequency.setTargetAtTime(pitch / 2, t, 0.05);
      engineTone.frequency.setTargetAtTime(300 + throttle * 900 + rev * 300, t, 0.08);
      engineGain.gain.setTargetAtTime(0.05 + throttle * 0.07 + Math.min(v / 40, 1) * 0.03, t, 0.1);
      windTone.frequency.setTargetAtTime(500 + v * 25, t, 0.2);
      windGain.gain.setTargetAtTime(Math.min((v / 35) ** 2, 1) * 0.12, t, 0.2);
      waveGain.gain.setTargetAtTime(sea * 0.35, t, 0.5);
      rainGain.gain.setTargetAtTime(rain * 0.08, t, 1);
    },
    /** Chase mode and nitro, each 0–1: how near the nearest police car and the helicopter are, and the boost. */
    chase(siren: number, rotor: number, nitro: number) {
      if (!ctx) return;
      const t = ctx.currentTime;
      sirenGain.gain.setTargetAtTime(siren * 0.05, t, 0.3);
      sweep.frequency.setTargetAtTime(siren > 0.85 ? 2.6 : 0.25, t, 0.4);
      rotorGain.gain.setTargetAtTime(rotor * 0.7, t, 0.3);
      nitroGain.gain.setTargetAtTime(nitro * 0.12, t, 0.08);
    },
  };
}
