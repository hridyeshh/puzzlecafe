// The heads-up display: speed, fuel, clock, a one-line hint, and the controls card. Plain DOM, styled in index.html.
const CONTROLS = [
  ['W S', 'drive'],
  ['A D', 'steer'],
  ['Q', 'autodrive'],
  ['F', 'refuel at a pump'],
  ['M', 'map'],
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
    '<div class="panel"><span class="speed">0</span> <span class="dim">km/h</span></div>' +
    '<div class="panel"><div class="row"><span class="dim">fuel</span><span class="pct"></span></div><div class="fuel"><i></i></div></div>' +
    '<div class="panel clock"></div>';
  const hint = document.body.appendChild(document.createElement('div'));
  hint.id = 'hint';
  const title = document.body.appendChild(document.createElement('div'));
  title.id = 'place';
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
  const clock = get('.clock');
  return {
    /** `fuel` is 0–1, or null in zen mode; `message` is the hint line, empty for none. */
    update(kmh: number, fuel: number | null, hours: number, message: string) {
      speed.textContent = String(Math.round(Math.abs(kmh)));
      pct.textContent = fuel === null ? '∞' : `${Math.round(fuel * 100)}%`;
      bar.style.width = `${(fuel ?? 1) * 100}%`;
      bar.classList.toggle('low', fuel !== null && fuel < 0.2);
      clock.textContent = `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}`;
      hint.textContent = message;
      hint.hidden = !message;
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
