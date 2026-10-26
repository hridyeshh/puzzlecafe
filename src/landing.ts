// The landing page: what puzzlecafe is, and a button that loads the game (three.js and physics load only then).
const params = new URLSearchParams(location.search);
const landing = document.getElementById('landing')!;
const start = document.getElementById('start') as HTMLButtonElement;

// Phones and tablets without a mouse or trackpad get the drive with autodrive on (see main.ts).
if (!matchMedia('(any-pointer: fine)').matches) document.getElementById('touch')!.hidden = false;

async function play() {
  start.disabled = true;
  start.textContent = 'Loading the coast…';
  await import('./main.ts');
  landing.remove();
}

start.addEventListener('click', play);
if (params.has('play')) void play();
