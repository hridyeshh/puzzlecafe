# puzzlecafe

An endless, calm driving game in the browser. It has slowroads.io's peace (endless roads, time of day, seasons,
weather) with richer graphics and distinct places: a coast, mountains, countryside, a desert highway, a dystopian
city. The places are fictional but feel real, and the user's products live in them the way brands live in the real
world: hoardings by the road, paperboxd bookstore cafés and bookstores, stickynotes and thelocalcode. Texture, not ads.

Single player. Roads are empty: no traffic and no traffic lights. Lanes, road signs and petrol pumps are in.
Desktop first; phones play too where they can.

## Decisions (2026-10-26)
- **The world is a pure function of (seed, x, z).** Biome, height, roads and POIs are computed on demand, never
  stored. One seed always builds the same world. Generation code imports no DOM or renderer and never calls
  `Math.random`, so it runs in workers and in `node --test`. This gives an endless world, a map of anywhere without
  loading it, "nearest pump" search and spawning in any place.
- **A road network, not one road.** An infinite jittered-grid graph (highway tier on ~2 km cells, a denser local tier
  in towns). Junctions let the player choose. Terrain is carved to the roads; road grades are limited.
- **Places** come from low-frequency climate noise (coast, mountains, countryside, desert) plus settlements at hashed
  points (towns, the dystopian megacity), named on the map. `landmarks.ts` pins hand-built set pieces at fixed
  coordinates; that is how places get polished over time.
- **Brands are a data registry**: name, colours, logo, posters, venue types. A new project is a new entry. Placement
  follows the real world (highway approaches, junctions, pumps, city walls), with capped density, no repeats within
  N km, and scenic viewpoints left clean.
- **Vertical slice first**: one place with everything before more places.
- **Mobile is a quality tier and an input scheme**, not a second game. The car reads `{ steer, throttle, brake }` from
  keyboard, gamepad or touch. Phones are cruise-first: autodrive steers, the player taps junction arrows or taps to
  pull into a pump. Devices too weak for the game get the landing page and a video.
- **Stack**: Vite + TypeScript; three.js `WebGPURenderer` + TSL with its WebGL2 fallback; Rapier
  (`@dimforge/rapier3d-compat`) for the vehicle and terrain colliders; DOM + Canvas 2D for HUD and map; localStorage
  and the URL hash for saves and share links. No backend.
- **Art style**: stylized realism. Real light and atmosphere, simple geometry.
- **Art direction (approved 2026-10-26)**: the six coast concepts in the Figma art bible are the visual target, all
  kept. They are one world in different states: golden hour (C1), bright midday (C3), overcast mist (C4), blue hour
  and night (C5); gouache (C2) and faceted (C6) are rendering-style references. "If we are building the way it looks
  in those generated images, we are going good." The user loved every car in them (classic coupes, a convertible):
  a garage of those cars comes in phase 2.
- **Fuel is gentle**: an empty tank limps at 20 km/h; a zen setting makes fuel infinite.
- **Drive side**: right-hand traffic by default. One constant; the user has not picked a side.
- **Floating origin**: world positions are float64 in JS; rendering and physics use positions relative to an origin
  that jumps with the car, so float32 never sees large numbers.
- Dependencies are pinned to releases at least two weeks old.

## Brands in the world (confirmed 2026-10-26)
| Brand | In the world |
|---|---|
| paperboxd | Bookstore cafés with a variant per place (beach shack, mountain lodge, brutalist city café, desert diner), bookstores in towns, hoardings. Cafés are rest stops: park for a cinematic pause, change time or weather, save the spot. |
| stickynotes | Map pins are sticky notes in the four highlighter colours (bookmark roads you love); murals. |
| thelocalcode | A studio in towns; "branding by thelocalcode" on fictional shop signs; hoardings. |
| Future projects | A registry entry and its creatives; placed automatically. |

Formats: roadside 48-sheet, highway unipole, city wall or mural, LED screens (dystopia, animated), neon at night.
Later, optionally: parking near a venue shows a small card with a link. Never pop-ups.

## Art pipeline
- Art bible first: about six concept candidates per place through Figma (GPT Image 2.5); the user picks, as with the
  stickynotes icon (`../stickynotes/PLAN.md`, Icons).
- Brand creatives (posters, murals, signage, neon, menu boards) are made in Figma from the brand assets in the sibling
  repos, processed like `../thelocalcode/scripts/process-art.py`, then compressed to KTX2.
- Ground and rock PBR textures and HDRI skies: Poly Haven and ambientCG (CC0).
- 3D: Figma Weave image-to-3D if it is available, else CC0 packs (Quaternius, Kenney) and procedural buildings. The
  hero car is bought or commissioned.
- The attached Adobe MCP is Experience Cloud only (orgs, sandboxes, data views); it has no image tools.

## Phases

### Phase 0: foundation and art direction (done 2026-10-26)
- [x] Vite, TypeScript, oxlint, `node --test`; this file and `CLAUDE.md`
- [x] `WebGPURenderer` with its WebGL2 fallback (`?webgl` forces WebGL2)
- [x] Seeded terrain (`src/world.ts`) streamed as 256 m chunks around the car, each with a Rapier heightfield
- [x] Rapier car; chase and hood cameras (C); keyboard and gamepad; R puts the car back on its wheels; the car holds
      still when parked
- [x] Floating origin: the world shifts back under the car once it is 1 km out
- [x] `?debug` overlay: backend, fps, draw calls, chunks, speed, position
- [x] Six coast candidates in the Figma file "puzzlecafe — art bible"
      (https://www.figma.com/design/7HTX3fKh1XKvLDCA8odcdH), C1 to C6 left to right: golden hour, gouache, bright
      midday, overcast, blue hour, faceted low-poly
- [x] Figma Weave has image-to-3D: Tripo H3.1 (~53 credits, can scale to metres), Hunyuan 3D V3 (~80), Meshy V6 (~96)

Exit: the car feels good on hills; 60 fps on an M1-class laptop; the user picks the art direction.

Verified 2026-10-26: tests pass; in Chrome on this Mac (headless, 1280×720) WebGPU and WebGL2 both hold 60 fps with
about 1M triangles and 49 to 63 chunks; a 45 s drive crossed the 1 km rebase with no seam.

Approved by the user 2026-10-26: the driving and the controls feel great; all six concepts kept (see Decisions).

Notes for phase 1:
- The build is one 5.2 MB file, mostly Rapier's compat build inlining its wasm as base64. Lazy-load the game behind
  the landing page; consider `@dimforge/rapier3d` with a separate .wasm file.
- The car spawns on the flattest point within 200 m of the origin; phase 1 spawns it on a road.
- The Claude in Chrome extension and the Playwright MCP bridge were not connected, so browser checks ran through
  `playwright-core` from `../thelocalcode` driving the system Chrome.

### Phase 1: vertical slice, "Coastal Drive" (built 2026-10-26; exit check partly open)
The whole vision in one place. Exit: 30 minutes of autodrive with no gaps or hitches; 60 fps on Medium; all three
brands seen in the first five minutes; it boots on one recent phone at Low (a smoke test only); a demo link to share.

Exit status (2026-10-26):
- 30 min autodrive: not proven yet. The soak (`?debug&play&t=8`, then Q) ran for 55 min of wall time, but the Mac
  idle-slept through most of it, so only about 8 min of real driving (about 10 km) happened. In that time there were
  no errors, 60 fps, and a worst frame of 18.5 ms. The car drove on after 14 sleep/wake cycles. Rerun it under
  `caffeinate -i` for a clean 30 min.
- 60 fps on Medium: yes, in headless Chrome at 1280×720 (WebGPU, about 200 draws and 0.9M triangles). Not yet checked
  on the user's own display.
- All three brands in the first five minutes: not measured. It needs the car's path every second, not every 20 s.
- Phone at Low: boots and autodrives at 79 km/h in a 390×844 emulation. Not tried on a real phone.
- Demo link: needs a deploy, which is the user's call (their other sites are on Vercel).

Steps (each is ticked here when done, so a new session can resume):
- [x] 1.1 World: fields, roads, carving, POIs; tests (determinism, seams, road height = terrain at the road centre, no
      roads in the sea, POIs on land and clear of junctions); the car spawns on the coast road. Done 2026-10-26:
      `src/world/{hash,fields,roads,pois,chunk,world}.ts`, 8 tests pass, a chunk builds in ~8 ms.
- [x] 1.2 Terrain colours, road ribbons with markings, junction discs. Done 2026-10-26: the ribbon geometry is built
      in `chunk.ts` (worker-ready); the paint is TSL in `main.ts`; 60 fps in Chrome with ~50 draw calls.
- [x] 1.3 Ocean. Done 2026-10-26: `src/ocean.ts` (Gerstner waves, depth colour and shore foam from the depth
      buffer); the sky is rendered into `scene.environment` (PMREM) for reflections. Still to do in 1.4: tone mapping
      looks hazy (AgX; try ACES and richer vertex colours). Still to do in 1.6: a car that ends up in the sea goes back
      to the nearest road.
- [x] 1.4 Day and night: clock, stars, night lights, headlights, bloom. Done 2026-10-26: `src/daylight.ts` (sun and
      moon, sky, fog, ambient, a night dome with stars, environment re-baked as the sun moves) exports a `night`
      uniform that glowing materials read. ACES tone mapping; exposure falls as the sun climbs; bloom via
      `RenderPipeline`. The clock starts at 16:30 (`?t=` picks), one game hour per two real minutes, T skips an hour.
      Checked at 12:30, 17:36 and 20:50.
- [x] 1.5 Brands: registry, Figma posters, two hoarding formats, paperboxd café, petrol station. Done 2026-10-26:
      `src/brands.ts` (registry: id, name, posters, weight); six posters generated in the Figma art bible (nodes
      8:2 to 13:2), masters in `art-src/posters/`, 2:1 web crops in `public/brands/`; `src/props.ts` builds the
      48-sheet and unipole hoardings, the café (bookshelf window and lit sign from canvas textures, the real logo)
      and the station from primitives, once, cloned per POI, with collider boxes. A chunk is now one group.
      `?at=x,z,yaw` starts anywhere.
- [x] 1.6 Autodrive. Done 2026-10-26: `src/autodrive.ts`, pure pursuit on the right lane (2 m off the centreline),
      80 km/h cruise, slows for bends (3 m/s² sideways) and to 9 m/s for sharp turns. At a road's end it picks a way
      (no U-turns); on the coast road it turns into an inland road 30% of the time. Choices are remembered per
      junction. Q toggles; any drive key takes over. A car in the sea goes back to the nearest road's right lane.
      Checked: 2 minutes held the lane (1.6–2.5 m from the centre); `src/autodrive.test.ts` covers the side-road
      choice.
- [x] 1.7 Fuel, refuelling, HUD. Done 2026-10-26: a tank lasts ~45 km (more on the throttle); empty limps at
      20 km/h; Z (or `?zen`) is endless fuel; `?fuel=0.3` starts low. Stop beside a pump island and hold F (+25%/s).
      `src/hud.ts` (speed, fuel bar, clock, a hint line, a controls card shown for 12 s, H toggles), styled with
      tokens in `index.html`. Checked: parked at a pump at 30%, F filled it to 100%.
- [x] 1.8 Map (M). Done 2026-10-26: `src/map.ts`, Canvas 2D: land and sea from continentalness, roads (the coast
      road on top), paperboxd cafés (pb) and stations (F), the car; drag pans, the wheel zooms (3–24 m/px), Esc
      closes; opens in ~70 ms. `world.mapData()` traces the coast coarser for big views; POIs anchor where the true
      contour crosses each line (bisection), so the map and the world agree at any tracing step.
- [x] 1.9 Trees, bushes, rocks (instanced). Done 2026-10-26: `chunk.ts` places one candidate per 7 m world-aligned
      cell (none on roads, pads, beaches or the sea; a `woods` field makes forests inland; scrub on the coast; rocks
      on steep ground); `src/plants.ts` merges vertex-coloured primitives per kind, instanced per chunk, with trunk and
      rock colliders; shown within two chunks of the car. ~150 plants per chunk, up to ~550 in woods; 60 fps.
- [x] 1.10 Workers, and LOD with skirts for far terrain. Done 2026-10-26: `src/worker.ts` (pool of up to 4) builds
      tiles with the pure world code (`src/tile.ts`, `src/terrain.ts`, `world.grid()`); `src/streaming.ts` turns
      them into meshes, props, plants and colliders, nearest first, at most 3 a frame. LODs: 2 m within 2 chunks
      (roads, props, plants, colliders), 8 m road-carved out to 5, 16 m out to 9 (~2.4 km); fog 350–2400 m. Only
      coarse tiles have skirts. Playable 1.2 s after load; 60 fps with ~220 draw calls and ~1M triangles over 380
      tiles; worst frame ~19 ms while streaming. Lessons: terrain casts no shadows (a low sun's hill shadows ended at
      the shadow map's edge); asphalt is 0x4a4c50 (darker read as a black hole at golden hour); junction patches are
      ROAD_HALF + 2; coast loops under 150 m are dropped. `?shadows=0` turns shadows off; `?debug` exposes
      `globalThis.puzzlecafe` (scene, origin, world).
- [x] 1.11 Audio: engine, waves. Done 2026-10-26: `src/audio.ts`, all synthesised with Web Audio (engine
      oscillators through five simulated gears, filtered by throttle; wind and tyre noise with speed; brown-noise
      surf swelling at 0.09 Hz, loud on the beach road and gone ~1 km inland). Starts on the first key or click;
      V mutes. Tiles now go in under a 6 ms per-frame budget instead of a count.
- [x] 1.12 Landing page, lazy-loaded game, Low/Medium/High presets, phone smoke test. Done 2026-10-26:
      `index.html` is the landing page (the C1 concept as hero, `public/art/coast.jpg`, master in
      `art-src/concepts/`); `src/landing.ts` loads the game only on Start (landing ~6 KB plus the image; the game
      1.94 MB gzipped). `?play` skips the landing. `?q=low|medium|high` (pixel ratio 1/1.5/2, shadows off/2048/4096,
      tiles out to 6/9/9 chunks); medium by default, low on devices with no mouse or trackpad, which also start in
      autodrive and hide the keyboard card. Checked in Chrome's phone emulation (390×844, touch): boots at Low,
      drives itself at 60 fps, HUD fits.

Design (worked out 2026-10-26; the constants are starting points to tune):
- Code layout: `src/world/` is pure (hash, fields, roads, pois, chunk, world); `src/main.ts` renders; `src/physics.ts`
  is Rapier.
- Fields (`fields.ts`), pure functions of seed and x, z:
  - Continentalness C: domain-warped noise (warp 700 m at a 3 km scale; noise at 8 km × 0.75 plus 2.6 km × 0.25;
    +0.12 bias). Sea where C < 0.
  - Cliffiness q = smoothstep(-0.15, 0.35, noise at 3.2 km).
  - Smooth height, which roads sit on: C·400 below sea level; on land C·150 + 30·smoothstep(0.002, 0.014, C)·q plus a
    9 m swell at 1.7 km faded in by smoothstep(0, 0.06, C). Road grades stay under ~8%.
  - Detail (hills): 5-octave fbm at 700 m, amplitude (4 + 34·smoothstep(0.06, 0.4, C))·smoothstep(0, 0.04, C).
- Roads (`roads.ts`):
  - Coast road: the C = 0.05 contour (about 100 m inland), traced by marching squares on an 8 m world-aligned grid, so
    any area traces on its own and neighbours agree. Saddles resolve by the cell-centre average. Across-road normal is
    ∇C/|∇C| (points inland), analytic, so ribbons meet exactly at chunk borders.
  - Inland roads: a jittered grid of nodes every 1024 m (jitter ±30%), nodes only where C > 0.08. Edges to the +x and
    +z neighbours exist with p 0.72; a node with fewer than two base edges forces more by hash, decided from base
    edges only so both ends agree. Edges are uniform Catmull-Rom curves through the neighbouring nodes' raw positions,
    sampled every ~8 m. Edges toward the sea extend straight past the sea-side node and are cut where they reach
    C = 0.05: T-junctions on the coast road.
  - Junctions: grid nodes that are not straight-through, and the coast T-junctions. Discs; lane markings fade there.
  - Road height is the smooth height at each road vertex.
- Terrain height (`chunk.ts`): with d the distance to the nearest road and R the nearest road point,
  h = lerp(roadH(R), smooth(P), k1) + detail(P)·k2, k1 = smoothstep(7, 21, d) flattens the cross-section,
  k2 = smoothstep(7, 147, d) fades hills in. k2 uses distances on a world-aligned 16 m lattice, bilinearly
  interpolated (same in chunks and in `heightAt`); k1 uses exact distances from 32 m segment buckets. Pads for cafés
  and stations flatten to the road height, but only outside the road's flat strip, so road heights never move.
  Inland (C > 0.12) the land never dips below 1 m, so no inland lakes.
- POIs (`pois.ts`): where the coast road crosses the lines x = k·640 m or z = k·640 m (hash per crossing): 18% café on
  the seaward side (landward if the cliff is too close), 18% petrol station landward, 40% hoarding. Grid edges: a
  station at the middle with p 0.2; hoardings at a quarter and three quarters with p 0.5. None within 60 m of a
  junction. Cafés and stations sit 34 m from the centreline, front to the road; hoardings 16 m, turned 20° toward
  oncoming traffic (right-hand). Areas are chunk ± 200 m; POIs are accepted within chunk ± 140 m, so junction checks
  always see every junction within 60 m and neighbouring chunks agree.
- Spawn: chunks in rings around the origin until one straddles C = 0.05; the car starts in the right lane of its
  coast road with the sea on the right.
- Rendering:
  - Road ribbons per chunk (a chunk owns segments whose midpoint is inside it) at +6 cm with polygon offset. u is
    scaled so each piece holds a whole number of 12 m dash periods, so dashes line up across chunks. Dashed centre
    line, solid edge lines; markings fade near junctions. Junction discs are plain asphalt.
  - Terrain vertex colours: sand (low, near the sea), grass, dry grass, rock by slope, gravel shoulders by road
    distance.
  - Ocean: a camera-following plane at y = 0, Gerstner waves in TSL, colour by water depth from
    `viewportLinearDepth` minus `linearDepth()`, fresnel to the sky, shore foam.
  - Day and night: a game clock drives the sun (SkyMesh), sun and hemisphere light, fog colour, stars, café windows
    and poster glow, headlights; bloom via `RenderPipeline` and `bloom()` from `three/addons/tsl/display/BloomNode.js`.
  - Verified r186 exports: `RenderPipeline`, `bloom(node, strength, radius, threshold)`, `viewportLinearDepth`,
    `linearDepth`, `fwidth`, `mx_noise_float`, `vertexColor`, `positionWorld`, `time`.

### Phase 2: more places (pending)
A garage of the art-bible cars (classic coupes, a convertible), via Weave image-to-3D or bought models.
Mountains (ridged terrain, switchbacks, snow line, guardrails), countryside and forest, a desert highway; blending
between places; region names; highway and local road tiers; seasons (palettes, snow cover); weather (rain, snow, fog);
a choose-a-place menu and fast travel; café variants; stickynotes map pins.

Exit: each place is recognisable from one screenshot; transitions are seamless.

### Phase 3: dystopian city (pending)
Street grids inside a settlement's radius; procedural brutalist towers from instanced modules; LED and neon
hoardings; rain with wet reflections; smog; lighting designed for night first.

Exit: driving the city holds 60 fps on Medium.

### Phase 4: quality tiers and mobile (pending)
A first-run benchmark picks the preset; dynamic resolution. High tier: ambient occlusion, TAA, clouds, vegetation
impostors. Mobile: touch pedals with tilt or drag steering, the cruise-first UI, a rotate-your-phone prompt, a PWA
install for fullscreen on iPhone, a memory budget for iOS Safari, an optional 30 fps cap.

Exit: High beats slowroads side by side; a mid-range phone holds 30 fps on Low.

### Phase 5: ship (pending)
Waypoint GPS (A* on the road graph), continue-your-drive saves, share links, radio and ambience, a KTX2 and Meshopt
asset pipeline, landing page polish with a trailer, deploy, testing across browsers and GPUs.

### Not planned
Photo mode, tunnels and bridges, interiors, multiplayer, shared sticky notes. No traffic and no traffic lights, by
decision.

## Next steps
- Nothing since `1bd958b physics and tests` is committed. Commit Phase 1 once the user says so.
- Finish the Phase 1 exit check:
  - Run a clean 30 min soak under `caffeinate -i`, logging the car's position every second.
  - From that path, work out the lane offset (`world.area(cx, cz).index.closest`).
  - From the same path, work out the brands passed in the first five minutes (hoarding POIs within about 40 m of the
    path; brand from `posterFor(pick)`).
- The user drives it on their own machine: `npm run dev`, then http://localhost:5173 (add `?play` to skip the landing).
- Decide where to deploy the demo link (Vercel, like the user's other sites), then deploy.
- Then Phase 2.
