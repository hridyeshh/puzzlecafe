// The heads-up display: speed and nitro, fuel, clock, a one-line hint, the controls card, and in a chase the stars and
// its time. Plain DOM, styled in index.html.
const CONTROLS = [
  ['W S', 'drive'],
  ['A D', 'steer'],
  ['Shift', 'nitro'],
  ['Q', 'autodrive'],
  ['F', 'refuel at a pump'],
  ['M', 'map'],
  ['B', 'garage'],
  ['P', 'chase mode'],
  ['C', 'camera'],
  ['T', 'skip an hour'],
  ['N', 'next weather'],
  ['G', 'next season'],
  ['Z', 'zen: endless fuel'],
  ['V', 'sound on/off'],
  ['R', 'back on the wheels'],
  ['H', 'this card'],
];

export function createHud() {
  const root = document.body.appendChild(document.createElement('div'));
  root.id = 'hud';
  root.innerHTML =
    '<div class="panel"><span class="speed">0</span> <span class="dim">km/h</span><div class="nitro"><i></i></div></div>' +
    '<div class="panel"><div class="row"><span class="dim">fuel</span><span class="pct"></span></div><div class="fuel"><i></i></div></div>' +
    '<div class="panel clock"></div>';
  const hint = document.body.appendChild(document.createElement('div'));
  hint.id = 'hint';
  const title = document.body.appendChild(document.createElement('div'));
  title.id = 'place';
  const stars = document.body.appendChild(document.createElement('div'));
  stars.id = 'wanted';
  stars.hidden = true;
  let shown = '';
  const help = document.body.appendChild(document.createElement('div'));
  help.id = 'help';
  help.innerHTML = CONTROLS.map(([key, what]) => `<div><kbd>${key}</kbd>${what}</div>`).join('');
  setTimeout(() => (help.hidden = true), 12_000);
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyH' && !e.repeat) help.hidden = !help.hidden;
  });

  const get = (selector: string) => root.querySelector(selector) as HTMLElement;
  const speed = get('.speed');
  const pct = get('.pct');
  const bar = get('.fuel > i');
  const boost = get('.nitro > i');
  const clock = get('.clock');
  return {
    /** `fuel` is 0–1, or null in zen mode; `message` is the hint line, empty for none; `nitro` 0–1. */
    update(kmh: number, fuel: number | null, hours: number, message: string, nitro: number) {
      boost.style.width = `${nitro * 100}%`;
      speed.textContent = String(Math.round(Math.abs(kmh)));
      pct.textContent = fuel === null ? '∞' : `${Math.round(fuel * 100)}%`;
      bar.style.width = `${(fuel ?? 1) * 100}%`;
      bar.classList.toggle('low', fuel !== null && fuel < 0.2);
      clock.textContent = `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}`;
      hint.textContent = message;
      hint.hidden = !message;
    },
    /** In a chase: heat 1–5 as stars and how long it has run, blinking while the police have lost sight; 0 hides it. */
    wanted(heat: number, seconds: number, lost: boolean) {
      stars.hidden = heat === 0;
      const text = `${'★'.repeat(heat)}<span class="dim">${'★'.repeat(5 - heat)}</span> ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      if (text !== shown) stars.innerHTML = shown = text;
      stars.classList.toggle('lost', lost);
    },
    /** The name of the region the car has just entered, shown for a few seconds. */
    place(name: string) {
      title.textContent = name;
      title.classList.remove('show');
      void title.offsetWidth; // restart the fade
      title.classList.add('show');
    },
  };
}
