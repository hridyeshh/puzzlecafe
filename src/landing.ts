// The landing page: what puzzlecafe is, and a button that loads the game (three.js and physics load only then).
const params = new URLSearchParams(location.search);
const landing = document.getElementById('landing')!;
const start = document.getElementById('start') as HTMLButtonElement;

// Phones and tablets without a mouse or trackpad get the drive with autodrive on (see main.ts).
if (!matchMedia('(any-pointer: fine)').matches) document.getElementById('touch')!.hidden = false;

// Chase mode: the level picked here is kept for the next visit (main.ts reads it), where storage allows. Cars are
// picked in the game's garage (B).
const levels = document.querySelectorAll<HTMLInputElement>('input[name=chase]');
try {
  const kept = localStorage.getItem('puzzlecafe.chase');
  for (const input of levels) if (input.value === kept) input.checked = true;
} catch {
  // no storage: the default
}
for (const input of levels) {
  input.addEventListener('change', () => {
    try {
      localStorage.setItem('puzzlecafe.chase', input.value);
    } catch {
      // not kept
    }
  });
}

async function play() {
  start.disabled = true;
  start.textContent = 'Loading the coast…';
  await import('./main.ts');
  landing.remove();
}

start.addEventListener('click', play);
if (params.has('play')) void play();
