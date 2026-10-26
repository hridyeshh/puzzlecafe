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

### Phase 1: vertical slice, "Coastal Drive" (done 2026-10-26, except the demo link)
The whole vision in one place. Exit: 30 minutes of autodrive with no gaps or hitches; 60 fps on Medium; all three
brands seen in the first five minutes; it boots on one recent phone at Low (a smoke test only); a demo link to share.

Exit status (2026-10-26):
- 30 min autodrive: done. A 30-minute soak of the production build (1440×900 @2x, under `caffeinate`) drove 37.4 km
  from 08:00 to 23:00 with no gaps and no errors: 60 fps median and at the 1st percentile; 62 of 107,941 frames over
  25 ms and 10 over 50 ms (worst 187 ms, with no JS work behind it, while builds ran alongside). Lane keeping: median
  2.0 m from the centreline (the right lane's middle), 95% within 1.5–2.5 m. Tools: `?debug` keeps every frame over
  25 ms with where its time went (`puzzlecafe.slow`, `puzzlecafe.totals`).
- The hitches the user felt while driving, found with that log and CPU profiles, and fixed:
  - The environment re-bake made a new PMREM texture every ~7 s near sunset, which recompiled every lit material
    (250–370 ms). It now re-bakes into the same target.
  - three.js builds shaders once per InstancedMesh (its cache key holds the uuid), so each new chunk's plants
    stalled 50–120 ms. Plants are now plain meshes with an InstancedBufferGeometry and per-instance attributes, all
    sharing one shader.
  - A rebase moved thousands of colliders one by one (~69 ms). Each tile's colliders now hang off one fixed body.
  - First sight of a café, station, wall or plant compiled its shader. A warm-up compiles them behind the landing.
  - Starting the AudioContext blocked ~130 ms on the first key. It is created at load and resumed on the first key.
- The map lag: tiles are drawn by two workers into cached bitmaps (`src/mapworker.ts`), so panning and zooming only
  move pictures; the 3D scene is not rendered while the map covers it; POI road clearance uses the bucketed index
  (exact under 32 m, checked identical on three seeds), so map data for a screen at 24 m/px went from 1.2 s to 0.1 s.
  Zoom 3–48 m/px about the pointer; a coarser tile stands in while a finer one loads; badges become dots, then hide.
- 60 fps on Medium: yes, in Chrome at 1440×900 @2x (like a Retina laptop).
- All three brands in the first five minutes: within 250 m in 4.1 minutes (paperboxd at once, a hoarding by the spawn,
  and a café at 2 min; stickynotes 1.4 min; thelocalcode 4.1 min). Passing within 40 m of each takes 6.4 minutes.
- Phone at Low: boots and autodrives in a 390×844 emulation. Not tried on a real phone.
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

### Phase 2: the look, then more places (in progress)
The user, 2026-10-26, after driving Phase 1: "the graphics are not yet how it looks in those generated images on
figma". So the coast is brought up to the concept art first (C1 golden hour is the hero shot, `art-src/concepts/
coast-c1.jpg`; C3 midday, C4 overcast and C5 blue hour are in the Figma art bible), and new places come after, built
to the same standard. Each step is checked side by side with the concept at the same time of day: the C1 framing is
`?at=-3535,-207,-1.83&t=17.6` (a cliff stretch of the coast road heading west, sea on the right).

Steps (first passes landed 2026-10-26; comparison frames from `?at=` spots, see the scratch scripts' notes below):
- [x] 2.1 Atmosphere: fog takes the colour of the sky behind it (the baked environment, blurred and capped so the sun
      cannot white it out); haze thicker at dawn and dusk and total at the tiles' edge; clouds (fractal noise on a
      dome, fair-weather, lit by the sun, pink in twilight); the clock runs at about half speed around sunrise and
      sunset; the sky (turbidity 2, rayleigh 2.5) dims as the sun climbs and the visible sky is repainted blue by day
      (pale low, deep high), since this sky model whites out at noon; twilight is a violet dome with a warm band
      toward the set sun, and blue hour is lit by the sky; after tone mapping, a CDL grade and a vignette.
- [x] 2.2 Ground: olive grass, golden dry patches, mottling and grain, strata on steep rock, wet sand at the waterline,
      anchored to the world. To do: the strata read as stripes on sandy sea cliffs; junction patches look too big.
- [x] 2.3 Plants: Mediterranean coast (scrub on ~27% of 7 m cells, olives, cypresses, the odd pine); lumpy faceted
      shapes that darken toward the base; wind sway in the shared shader (shadows sway too).
- [x] 2.4 Roadside: dry-stone walls (blocks ~1 × 0.45 m, 0.9 m high) on the sea side of the coast road where the
      ground drops 2 m within 12 m of the edge, with colliders, open at junctions, cafés and stations; asphalt grain,
      wheel tracks, worn paint; bushes now grow up to the shoulder (6.5 m from the centre; trees and rocks 11 m).
      Road signs, made with the chunk in the worker (`signs()` in `chunk.ts`, faces in `props.ts`, pole colliders):
      "café 100 m →" with the paperboxd logo and "FUEL 100 m →" 90 m before each café and station on the driver's
      right both ways, the blue coast-road sign of the concepts every ~600 m of coast road, chevrons on the outside of
      bends turning over 17° within ±24 m (none on today's gentle roads; they are for mountain switchbacks). Faces
      catch the headlights at night.
- [x] 2.5 Café and station dressing: the café after the concept art (`props.ts`: pale stone front, a deep glass room of
      bookshelves and pendant lamps, dark fascia letters that glow at night, a raised terrace with eight tables,
      parasols, planters, string lights, lamp posts; merged per material, ~12 draws). The station: a white canopy
      with a teal band and a lit underside, pumps with crowns, screens and hoses, a shop with a glass front of book
      shelves, a FUEL totem with price rows, kerbs, planters; pump islands stay where `atPump` looks.
- [ ] 2.6 The garage: for now a procedural roadster after the art-bible cars (`src/car.ts`: extruded profile with wheel
      arches, clear-coated paint, open cockpit, windscreen, lamps; `?car=champagne|green|silver|red`). Real models
      (Weave image-to-3D, about 53 credits a car with Tripo) wait for the user's go; then a car picker on the landing.
- [x] 2.7 Sea: surf lines rolling onto beaches; turquoise over sand deepening to blue offshore; ripples in the normals
      (not the surface) break the sun into glitter near the car and fade by 260 m, where they would alias into moiré.
- [x] 2.10 Brand posters in each product's own style. The user, 2026-10-26: "thelocalcode posters are very bad, make
      them using the art style and design style we followed in thelocalcode codebase too, that is one of my best
      design work". Done 2026-10-26: composed from thelocalcode's own assets, tokens and words rather than generated:
      (1) the Mac with the real stickynotes site on its screen, the poking hand, "Built like a product, not a
      template."; (2) the Tangle idea, five vendors' cables against "With us, it's one straight line." from "you" to a
      lit bulb. Fraunces, Bricolage Grotesque, ink outlines, hard shadows, cream. `node
      art-src/posters/thelocalcode.mjs` remakes them (masters in `art-src/posters/`, 1024×512 in `public/brands/`).
      Also: plants keep 22 m clear of hoardings so no tree hides a board; the big board's post stands behind it.
- [x] 2.8 Ground cover: tufts of dry grass (two-sided blades, golden tips), yellow broom and lavender (near the sea) on
      a 3 m grid within 45 m of roads, clear of sand, rock and props; ~720 per chunk through the shared instanced
      plant shader, no shadows. With it: 60 fps, ~2.2M triangles, ~276 draws (1440×900 @2x, Medium).
- [ ] 2.9 More places. Done (2.9a, 2026-10-26):
      - Places come from two climate fields at the scale of a long drive (`fields.ts`): mountain ranges (30 km
        noise) and deserts (34 km), each tens of km across. They lift continentalness, so each is one landmass, and
        the Mediterranean coast and its islands lie between them; countryside is the land in between (C ≥ 0.18).
        Spawn stays on the coast ("Cypress Bay"); countryside 1.4 km, mountains 2.2 km, desert 11 km from it.
      - Mountains: the land rises 260 m over many km (a wider span of the same field, so roads climb gently), and
        ridged peaks up to 250 m stand on top, fading out over the whole ~200 m the world knows of roads (squared),
        so each road runs up a valley; conifers to the tree line (~420 m), meadow grass, more rock, snow from
        ~430 m on slopes it can lie on, lavender for alpine flowers. Desert: flatter hills, dunes, sand and red
        rock, no trees, sparse dry grass.
      - Inland roads ease their heights over ±150 m (ends pinned, so junctions still meet); inland of C 0.2 the land
        rises at 60 m per unit of C instead of 150. Road grades: median 3.7%; short ramps up to ~25% remain where
        inland roads leave the coast.
      - Region names (`world/places.ts`): ~9 km jittered cells named by the kind of country at their centre
        ("Lavender Coast", "Willow Vale", "Granite Peaks", "Ochre Mesa"); the name fades in at the top of the screen
        on entering a region; the map shows names when zoomed out, colours the land by kind (snow, desert) and
        hill-shades it.
      - Travel: the map has Coast, Countryside, Mountains and Desert buttons; each starts the drive again on the
        nearest road of that kind (`findPlace`, ~25 ms) at the same hour. `?place=coast|country|mountains|desert`
        (with `&from=x,z`) does the same, and the landing page links to all three inland kinds.
      - Cafés inland too: halfway along a grid road, 10% of the time (stations 12%), each in the style of its
        country (the worker tags it with the biome): the coast's stone café, a brick farmhouse with a red tiled
        pitched roof, a timber mountain lodge with a slate roof, an adobe desert diner. Same terrace, books and sign.
      - Desert: flat-topped mesas up to ~55 m (red rock on their sides, from the slope rule) and saguaro cacti.
      - Weather (`src/weather.ts`): clear, cloudy, fog, rain or snow, a new spell every ~7 min drawn for the place
        (rarely rain in the desert, snow instead of rain above 300 m in the mountains), fading over ~30 s; N steps to
        the next, `?weather=` starts in one. Shared uniforms: cloud cover (thicker, greyer clouds; the sky turns a
        soft grey; the sun dims and its shadows fade; skylight fills in), mist (haze), wet (rain streaks; the road
        darkens and shines; a rain hiss), snow (soft round flakes) and snow lying on level ground, building while it
        snows and melting after. Drops fall through a 50 m box that wraps around the camera, so they stay put in the
        world; none within ~2 m of the camera.
      - Seasons (in `weather.ts`): spring, summer, autumn, winter, one a game day (a year in ~3.5 hours of driving),
        each blending into the next over its last third; G skips ahead, `?season=` starts in one, and a new season
        is announced like a region. The ground takes the season's tint (fresh green, golden, golden-brown, grey); leafy
        parts of plants (a per-vertex weight: broadleaf canopies, scrub, broom, grass; not conifers, cypresses, olives,
        rocks or cacti) turn orange to red in autumn, each plant its own, and dull brown in winter; in winter snow lies
        on level ground where it is cold, a per-vertex weight from the terrain (inland, not desert), so the coast and
        the desert stay clear; roads stay ploughed.
      - stickynotes map pins (`map.ts`): sticky notes in the stickynotes extension's four highlighter colours (yellow
        `#f2d14b`, pink `#ef8fb7`, blue `#86b6ea`, green `#93cf8c`), picked from swatches beside the travel buttons.
        Click the map to pin the nearest road (right lane, facing along it: `roadNear` in `places.ts`, which
        `findPlace` now uses too); click a pin to drive there; right-click or ctrl-click takes it off. Pins and the
        chosen colour are kept in localStorage (`puzzlecafe.pins`, `puzzlecafe.ink`); without it they last the visit.
        Travelling (pins or buttons) keeps the hour and the season.
      - Road tiers (`roads.ts`): every third grid line is a highway (~3 km cells; ~40% of inland road): always
        built, nodes barely jittered across it so it runs nearly straight, 3.5 m lanes with 2.5 m shoulders (half
        width 6.2 m, edge lines inset at the lane edge). The rest are local roads: half width 3.3 m, too narrow for
        edge lines, centre dashes only. The coast road is unchanged (4 m). Each `Road` and `Junction` carries `half`;
        `RoadIndex` distances are measured from the asphalt edge plus ROAD_HALF, so carving, verges, plant and POI
        clearance scale with width; junction patches fit their widest road; `laneOf(r)` centres the car in narrow
        lanes (autodrive, pins, rescue). The map draws highways wider in warm yellow.
      - Guardrails (`chunk.ts` `barriers()`): steel W-beam guardrails on posts every 4 m along inland roads where the
        ground drops 3 m within 12 m of the edge (either side; ends dip into the ground; colliders), stone walls on the
        coast road as before (2 m). Built along whole roads and kept per owned segment, so runs and stone courses carry
        across chunk edges. About 3% of countryside and 4–5% of mountain roadsides; chunk builds stay ~11 ms.
      To do: switchbacks. Idea: some mountain local edges become passes; the middle of the edge zigzags (legs ~40 m
      apart, ~9% grade, hairpins ~20 m radius) over a ridge H(u) along the edge axis, and the terrain gets the same
      ridge (a pure `passLift(x, z)` added to the smooth height), otherwise the carving blends to the valley floor
      between legs and they stand on embankments. Bend signs and guardrails then follow from existing rules;
      autodrive already slows for sharp bends. Then the exit check below.

Exit: next to C1, C3 and C5 at the same time of day, a viewer reads it as the same place; each new place is
recognisable from one screenshot and transitions are seamless; 60 fps on Medium.

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
- Nothing since `1bd958b physics and tests` is committed. Commit once the user says so.
- Phase 2, the biggest gaps to the concepts, in order: the car (real models need the user's go on Weave credits);
  cliffs and a coast road high above the sea (terrain shape); planting dense right up to the road; cafés and
  hoardings close to the road as in the concepts; road signs and lamps; villages on the hills.
- Decide where to deploy the demo link (Vercel, like the user's other sites), then deploy.
- Checking the look: comparison frames come from `?play&at=-3535,-207,-1.83&t=17.55` (C1), `t=12.5` (C3),
  `t=18.45` (C5), and the café at `?play&at=-1618,1315,-2.52&t=17.4` / `t=20.5`. Hitches: `?debug`, then read
  `puzzlecafe.slow` (each slow frame with its parts: drive, physics, world, camera, light, tiles, render).
