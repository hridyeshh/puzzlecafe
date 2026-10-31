# puzzlecafe

An endless, calm driving game in the browser. It has slowroads.io's peace (endless roads, time of day, seasons,
weather) with richer graphics and distinct places: a coast, mountains, countryside, a desert highway, a dystopian
city. The places are fictional but feel real, and the user's products live in them the way brands live in the real
world: hoardings by the road, paperboxd bookstore cafés and bookstores, stickynotes and thelocalcode. Texture, not ads.

Single player. Roads are empty: no traffic and no traffic lights (only the opt-in chase mode's police).
Lanes, road signs and petrol pumps are in.
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
- 3D: Figma Weave image-to-3D (Tripo H3.1, through the Figma MCP's `weave_run_model`: 53 credits standard, 68
  detailed); a clean studio shot of the object made in the art bible goes in, a GLB comes out (see 2.6). Each
  Weave account gets two free model runs from the agent and then needs a paid plan, whatever credits it still holds
  (the second account's 14 are stuck behind that). Free route: Microsoft's TRELLIS.2 Space on Hugging Face, driven
  with `gradio_client`; its ZeroGPU quota needs an HF token (`HF_TOKEN` in `.env`). Else CC0 packs (Quaternius,
  Kenney) and procedural buildings.
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
  junction. Cafés and stations sit 34 m from the centreline (cafés 18 m since 2026-10-27), front to the road; hoardings 16 m (11 m), turned 20° toward
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

### Phase 2: the look, then more places (in progress: every listed gap closed 2026-10-31, the user judges the frames; the new cars of 2.13 come one a day)
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
      anchored to the world. The strata, which read as stripes on sea cliffs, became rock judged per triangle with gullies
      and a bump (2026-10-30, Next steps). (Junction patches: smaller, 2026-10-27.)
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
- [x] 2.6 The garage. Done 2026-10-26 for two cars: the champagne roadster (C1, C3, C5) and the green rear-engined
      coupe (C4). Each starts as a clean studio shot of the concept car made in the art bible (nodes 15:2 to 18:2,
      masters in `art-src/cars/*.jpg`; fictional, no badges), then Tripo H3.1 image-to-3D in Figma Weave (detailed, 68
      credits a car): ~56k triangles, PBR, interior, 4096 px textures (`art-src/cars/*.glb`). `python3
      art-src/cars/process.py` cuts the textures to 2048/1024 px JPEG (9.6 → 2.6 MB) into `public/cars/` with
      thumbnails. `loadCar` (`src/car.ts`) scales each to its real length, turns it to +z, cuts its four wheels out of
      the mesh (triangles inside each tyre's cylinder; axles and radii measured once, in `GARAGE`) onto pivots that
      roll and steer, and makes red and amber lamp texels glow at night. The landing page has a car picker (kept in
      localStorage, `?car=roadster|coupe`); the procedural roadster stays as the fallback and for
      `?car=champagne|green|silver|red`. The fastback (C2) and the white 70s coupe (C6) have reference shots ready
      (`fastback.jpg`, `gt.jpg`) but no model: the Weave account is out of credits.
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
- [x] 2.9 More places. Done (2.9a, 2026-10-26):
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
      - Mountain passes (2.9b, 2026-10-26, `world/passes.ts`; the grid's topology moved to `world/nodes.ts` so the
        land and the roads share it). Some local mountain edges climb over a ridge in hairpins and come down the
        other side the same way: 4 or 6 legs a face, 110 m long and 44 m apart, hairpins of 22 m radius, 8.5% along
        the road, a 60 m crest 61 or 91 m up. At most one pass meets a node (nodes pair up in 2×2 blocks), so passes
        never cross; edges whose land is steep (over 10% in 50 m, or 4% end to end) get none. The pass levels the land
        under it to a plane from its entry to its exit and raises the ridge on that, twisted between legs (a triangle
        wave along the axis) so each leg lies along the hillside: roads follow the land up as everywhere else, with
        no embankments. 35 passes within 14 km of the spawn on seed 1; the nearest is ~3.9 km away
        (`?play&at=2400.3,2532.9,0.364`, heading for it). Hairpins are sampled every 3 m, so `ease` now takes the
        mean from the heights' integral (whole vertices sliding in and out of the window made 0.5 m steps); grades
        over the pass hold at 8–9%. Guardrails appear on the downhill side of every leg and chevrons at every
        hairpin (the bend finder now puts them mid-arc); half the passes have a café (a lodge) on the crest.
        Autodrive goes over at up to 45 km/h and looks closer there (it cut hairpins by ~1.7 m; now within 0.8 m).
        Chunks with a pass build in ~18 ms against ~17 ms for other mountain chunks; 60 fps on the pass.
- [x] 2.11 The garage, in the game (the user, 2026-10-31: "make the coupe the default car and add a key that take you to
      the garage where all the cars are parked and you can choose then"). Done 2026-10-31: the landing page's car picker
      is gone (it picks the chase mode now); the coupé is the default; B opens `src/garage.ts`, a concrete hall where
      every `GARAGE` car stands in a bay under strip lights (its own scene, loaded on first open, the drive paused); ← →
      browse, Enter drives the one in front (its model swapped onto the same body, the headlight kept so nothing
      recompiles; kept in localStorage), Esc or B goes back.
- [x] 2.12 Nitro (the user: "a key like shift that increases the shift like how nitro does in need for speed"). Done
      2026-10-31: hold Shift (a pad's A) with the throttle down: 2.6 times the engine (to ~230 km/h), a tank of ~4 s that
      refills over ~20 s (a cyan bar under the speed), blue flames from the tail, the view widening to 74°, a rush of air.
- [ ] 2.13 More cars (the user, 2026-10-31: "a car that looks like batmobile, and similar car options", then "make them
      all"). Six studio shots, all picked, in the Figma file "puzzlecafe — garage candidates"
      (https://www.figma.com/design/4naK8Fajixccu2iijE0pSX, left to right), masters in `art-src/cars/`: interceptor (a
      long jet-age night interceptor with a turbine nose and fins: the Batmobile's spirit without its emblem or exact
      shape, which belong to DC), armored (a wide armored rally interceptor), stealth (a faceted stealth-jet coupe),
      scanner (an 80s black wedge with a red scanner strip), blower (a 70s black muscle coupe with a supercharger), hyper
      (a matte black retro-futurist hypercar). Each becomes a GLB through TRELLIS.2 (`art-src/cafes/trellis2.py`, 100k
      faces at least), then `process.py`, then a `GARAGE` entry measured like the others (TRELLIS output is front +z,
      not Tripo's +x: `nose: 'z'`; front and rear wheels may differ: `radius: [front, rear]`, smaller ones riding
      lower). Done 2026-10-31: the Interceptor (5.4 m, big rear wheels; 70 s on TRELLIS) and the Armoured (4.6 m, off-road
      tyres; 105 s), both in the garage and driven. Then the free quota's daily run limit stopped it: stealth, scanner,
      blower and hyper wait, two a day; HF PRO (40 min a day) or a paid Weave plan would do them at once.
      The user, 2026-10-31: the new cars "aren't rendered that well". TRELLIS models are softer than Tripo's (lumpy
      tyres, mottled texture, no normal map); `loadCar` now smooths their normals and gives them an even gloss instead of
      their noisy roughness and metal maps, which helps but does not match the coupé. To redo them (and make the other
      four): Tripo H3.1 detailed, as the coupé was, through Weave on a paid account or Tripo's own API with the user's
      key; else TRELLIS at its best settings (resolution 1536, 300k faces, 4096 px textures). The user chose Tripo:
      `art-src/cars/tripo.py` (Tripo API v3, `v3.1-20260211`, detailed geometry and textures; `TRIPO_API_KEY` in
      `.env`; `--balance` shows the credits). The key works but its API balance was 0 on 2026-10-31: API credits are
      bought on platform.tripo3d.ai, apart from the web app's free ones. Then: all six cars through it, `process.py`,
      measured `GARAGE` entries (Tripo's nose is +x, the default).
      Also fixed that day (the user: "i just heard sirens, there were no police cars"): the first police car spawned
      ~185 m behind and needed ~22 s to catch a car at 125 km/h, never at nitro speed, while its siren carried 350 m.
      Police now spawn 110–170 m away at the player's speed, use nitro while over 60 m behind, sirens carry 250 m and
      fade faster, and a chase in which nobody ever sees the player ends after 45 s. At 125–145 km/h they are in sight
      ~7 s after the chase starts and alongside in ~20 s.
      Lag the user felt in a hard chase on nitro, 2026-10-31: it came while my headless test browsers (1440×900 @2x)
      shared the GPU. Measured alone, a hard chase fleeing at up to 176 km/h with nitro bursts held 58.7 fps (13 frames
      over 25 ms in 60 s, none over 50; the slow ones waiting on the GPU, ~1–6 ms of JS); full detail always under the
      car. Left: ~4 frames of ~35 ms when the first police car comes into view. `?cruise=` (m/s) sets autodrive's
      speed for soak tests at speed.
      The user then still felt it on their machine, with nitro. A Chrome trace here shows ~3 ms of JS a frame and no
      long GC or GPU tasks, so theirs is GPU-bound, and nitro made it worse: widening the view from 60° to 74° drew
      ~1.7 times the scene. Now the boost widens it to 66° (~1.25 times), and the renderer has dynamic resolution
      (`adapt` in main.ts): when the average frame runs over ~19 ms it draws fewer pixels, down to half, and draws more
      again after ~4 s of room; `?debug` shows it as `res`.
      The user, still, 2026-10-31: "the graphics are still lagging sometimes". Their machine is a fanless MacBook Air (M4)
      on a 4K display at 120 Hz (1920×1080 points, so 2880×1620 drawn at Medium). The game drew a frame on every refresh
      and the GPU managed ~72–80 fps there, so frames came 8 and 17 ms apart in turn: in a real Chrome window on that
      display, 329 gaps of 8 ms, 294 of 17 and 11 over 20 in 8 s. That reads as stutter, and it kept the GPU flat out. Fixed:
      - The loop draws at most one frame per 10 ms of rAF time: 120 Hz draws every other refresh (measured: 479 frames in
        8 s, every one 16.7 ms apart), 144 Hz at 72 fps, 90 Hz and below every refresh. (Chrome's uncapped test mode,
        `--disable-frame-rate-limit`, stalls ~16 ms on a skipped frame; benchmarks feed the loop times that pass.)
      - MSAA is 2 samples at a pixel ratio over 1, 4 at 1×: 86 fps against 71 unthrottled at 2880×1620 (no MSAA gains
        nothing over 2).
      - The cloud dome is a hemisphere: the transparent sea did not hide the shading below the horizon.
      - Dynamic resolution stays off a scale that proved too slow for a minute (in a hard chase it swung back into slow
        frames every few seconds). A resolution step costs no visible frame.
      Measured at 1920×1080 @2x: a sunset drive with chase mode on, 59.8 fps; a hard chase, 60 fps and no frame over
      25 ms, though that chase stayed at heat 2 or below. Earlier hard chases with five police cars and the helicopter
      hit 51–55 fps for a few seconds. The garage cars are 55–100k triangles each, and three.js's own draw-call work grew
      to 8–13 ms then.

Exit: next to C1, C3 and C5 at the same time of day, a viewer reads it as the same place; each new place is
recognisable from one screenshot and transitions are seamless; 60 fps on Medium.

Exit check, 2026-10-26 (frames at the C1 framing at 17:33, 12:30 and 18:27, the café, and `?place=` for each inland
kind, 1440×900 @2x, Medium; seed 1):
- 60 fps on Medium: yes, in every frame (the countryside's worst frame 25 ms); 1.0–2.1M triangles, 180–235 draws.
- Each new place from one screenshot: yes. Countryside (pines, snowy range behind), mountains (a conifer valley under
  rock walls), desert (dunes and saguaros) and the passes read at a glance.
- The same place as C1, C3 and C5: not yet. Light and time of day match (the low sun and haze at C1, the violet blue
  hour and glowing tail lights at C5, the car now that of the concepts), but the frames miss what makes the
  concepts: the café and hoarding right by the road, stone walls, dense planting up to the road, cliffs and a coast
  road high above the sea, villages on the hills, the deep blue midday sky with cumulus (ours is pale), and, at the
  C1 spot, a large junction patch fills the foreground. Phase 2 stays open on these.

Exit check, 2026-10-31, after closing those gaps (Next steps has each; the sheet is beside a café on a cliff stretch,
`?play&at=-251,619,-0.56&weather=clear` at `t=17.55`, `12.5`, `18.45`, against C1, C3 and C5, now in
`art-src/concepts/`):
- Light, sky, clouds, sea and palette match: the C3 sky within a few levels of its colours, heaped cumulus, a deep blue
  sea that is turquoise over sand, golden-olive ground, the C1 low sun and the C5 violet blue hour with lit windows.
- Still different, for the user to judge: the composition. The concepts' café shows its long glass front and lit sign
  beside the road; ours turns the coast model's blank side wall to oncoming traffic. Roadside planting is sparser, no
  hoarding or village is in that frame, and the beach under the cliff is not seen from the road.
- 60 fps on Medium: 59.6 by day and 58.8 at night (30 s of autodrive from the spawn, 1440×900 @2x, 2 and 8 frames over
  25 ms, none over 50); 57.6 on a night run past a village, ~3.7M triangles drawn, mostly plants. Runs taken while
  Brave used over 100% CPU fell to 36–50 fps, so re-measure on a quiet machine.

### Chase mode (built 2026-10-31; the user judges the rush)
The user: "add a chase mode, like police cars be chasing you and you can choose difficulty, it will give it an
adrenaline rush ... You can turn it off too but let's add police cars and helicopters that are chasing me the way it
happens in gta." Opt-in, so the calm drive stays the default.
- `src/chase.ts` (pure of three.js, so `src/chase.test.ts` runs a chase on real terrain): the rules and the AI.
  Police cars are Rapier vehicles like the player's (`createCar` now takes `power` and `grip`). Far off they drive the
  roads (autodrive now takes a target: at each junction the way that points at it, and a cruise speed); within 70 m, or
  with the player behind them, they drive straight at it across whatever is in the way; oncoming ones slow to turn round;
  stuck ones back out; ones 450 m behind, flipped or in the sea drop out and others come. They spawn 140–220 m away on a
  road (behind, then ahead, by turns), already moving, only where the ground is loaded.
- Rules: a chase starts 5 s after the mode goes on and 40 s after the last one ended (the defaults picked for the open
  questions: no patrol car to speed past yet). The police see along Rapier rays (hills, buildings, walls block; cars do
  not); heat (1–5 stars) rises every 30 s they see you, bringing more cars and then the helicopter; out of everyone's
  sight for the level's time (half as long again with the helicopter up) escapes; stopped with a police car within 8 m
  busts you, held 3 s, then back on the road. The HUD shows the stars (a red and blue underline while seen, blinking
  while they search) and the chase's time; the hint line says what to do; titles announce Police, Busted, Escaped after
  m:ss. Everywhere there are roads.
- Difficulty (`LEVELS`): units per heat (easy 1–3, normal 1–4, hard 2–6), engine 0.9/1.05/1.2, grip 1.5/1.7/1.9, how
  much faster than you they drive and what they do touching you (back off, hold, shove), the helicopter at heat 4/3/2 and
  28/36/44 m/s (a car flat out is ~47), sight 110/140/170 m, escape 7/10/14 s, bust 2–4 s.
- `src/police.ts`: each police car is one of the garage's cars at random (the user, 2026-10-31: "for the police cars,
  use any one random car that we have"), in its own paint with a red and blue light bar on the highest point over its
  middle; the garage models load when chase mode first goes on and are compiled out of sight under the road before
  they are needed. Until then a stand-in: the roadster's body in black and white with a hardtop, white POLICE doors, a
  push bar and a light bar, merged by material into 8 draws a car and cloned; a navy helicopter with a white
  boom, turning rotors, nose down and banked as it flies, 30 m up on a 55 m circle; at night a searchlight (the only
  real light, made at load) with a faint beam. Siren (a wail, a yelp up close) and the rotor's chop in `audio.ts`.
- Switches: Chase mode Off/Easy/Normal/Hard on the landing page (kept), `?chase=`, and P in the game.
- Checked 2026-10-31 in headless Chrome (1280×720, WebGPU): 60 fps through a hard chase with three police cars and the
  helicopter (worst frame 23 ms); the test busts a stopped car in ~18 s and escapes 10 s after leaving sight.

Exit: a chase on normal holds 60 fps on Medium and the user calls it an adrenaline rush.

### Phase 3: cities (in progress: Prakashi's first pass landed 2026-10-31, then bigger, with outskirts and Bebop-era buildings the same day; the vision from the user, 2026-10-31)
Cities after India's, each with its own twist, under fictional names so nothing clashes later (the GTA way: Los Santos
is clearly LA but free to be its own thing). Stylised, not photoreal; each with a distinct mood, not just a skyline,
and a reason to visit. The first is the user's own seed, a dystopian Kashi.
- Candidates (Sanskrit or old-name roots; check each against existing games and brands before it is final):
  1. **Prakashi** (Kashi): a dystopian river city of light. Ghats step into a black river of floating lamps; temple
     spires in scaffolding and cable; the sky holds abstract light-forms (turning mandalas, glowing yantras), never
     deities, which keeps the eerie mood without depicting anyone's gods. A state broadcast that a pirate voice keeps
     hijacking. Lanes down to the ghats; a riverside expressway on stilts; night first.
  2. **Indrapuri** (Delhi): a hopeful green capital. Vertical-forest apartment towers, ring roads and big roundabouts,
     old domes under green, solar canopies over the highways; golden mornings.
  3. **Saptadweep** (Mumbai, "seven islands"): a monsoon city half under water. Canals between towers, a sea link
     and train viaducts on stilts, almost always rain, neon on wet roads; the city of raised highways.
  4. **Gulabgarh** (Jaipur): a pink sandstone solar desert city. Mirror fields round a solar tower, wind towers,
     stepwells as reservoirs, fort walls on the ridges, long straight desert roads.
  5. **Sutanuti** (Kolkata): foggy retro-futurism. Trams on overhead wires, colonial fronts with neon Bangla signs, a
     giant cantilever bridge in fog; dusk all day.
  6. **Udyanapuri** (Bengaluru, "garden city"): the traffic jam has moved into the sky (drone lanes overhead), which is
     why the roads below are empty; glass campuses under rain trees, lakes, flyovers.
  7. **Himmarg** (Ladakh, "snow road"): passes strung with prayer flags, monasteries on crags, frozen lakes; the engine
     loses power with altitude (thin air you feel).
- A city kit: modular building pieces plus a theme per city (palette, fog, sky, landmark set) placed procedurally, so a
  new city is mostly art and config, not engine code. Holograms are cheap here: additive blending and the bloom we have.
- Each city's story plays in the background, and the player can stop listening. It is part of the world, not a
  narrator: a city radio, a broadcast tower, the sky projections speaking (in Prakashi a state broadcast with someone
  hijacking it to tell the real version). Fragments are tied to places, not time ({city, region, fragment,
  prerequisites}, triggered by geofences on the client), kept as heard in localStorage, replayable from a journal, so
  muting loses nothing. Audio streams per fragment, preloading those nearby; full, ducked under music, or off; captions
  and transcripts (most people play muted; deaf players too). Voices: TTS to prototype, actors for the final story.
  With good spatial audio this goes some way to a game blind players can enjoy.
- Agreed with the user, 2026-10-31: Prakashi first, the names as they are, free roam (no missions).

Steps:
- [x] 3.1 Art direction: six Prakashi concepts in the Figma file "puzzlecafe — Prakashi"
      (https://www.figma.com/design/K7wJnoaMB7TDkdZmNNYPY3, nodes 1:2, 1:3, 1:4, 3:2, 4:2, 4:3; masters
      `art-src/concepts/prakashi-c1..c6.jpg`): C1 night on the riverside expressway on stilts, the ghats and spires on the
      left, a turning yantra over the river; C2 blue hour from the river; C3 a lane down to the ghats; C4 monsoon night;
      C5 smoggy dawn; C6 the C1 view faceted, low-poly. For the user to pick, as with the coast's six.
- [x] 3.2 The city in the world (`world/cities.ts`, `world/blocks.ts`; pure, tested; its size, placement and edge changed in
      3.8). One Prakashi per seed: the first
      spot ringing out from the origin, 5 to 30 km out, where it fits on land clear of the coast road, not in the
      mountains or desert, within ±60 m of level. Seed 1: (-14093, -5136), 15 km from the spawn, level 102 m. A 1.3 km ring
      road closes it; inside, continentalness as roads see it (`fields.open`) is as if the sea, so inland roads end on the
      ring in T-junctions as on the coast road, and grid nodes keep 300 m clear. The land levels to the city over 450 m
      beyond the ring, with no hills inside. The river is a crescent: an arc of 2.2 km radius about a point outside the
      city, 280 m wide, 1.85 km long between barrages 250 m inside the ring (no bridges needed), the water 11 m below the
      city and 4 m deep; on the city's bank, ghats in 14 broad steps over 36 m; on the far bank, sand rising over 90 m.
      Streets (in `roads.ts`, `city` roads): avenues in arcs along the river 150 m apart, the first 70 m behind the ghats;
      lanes out from the river every ~130 m; all split at every crossing so autodrive picks a way at each (it drives the
      city at 60 fps). Countryside cafés, stations and hoardings stay off them. Buildings: ~12,000 in rows out from the
      river, 13 × 15 m cells, clear of the streets by 2.5 m of pavement: palaces of five to nine floors along the ghats,
      two to six floors further out, now and then a tower of 10–17; six temple spires on the riverfront and broadcast
      towers. No plants or villages in or against the city. `?place=city` and the map's Prakashi button start on the
      riverfront avenue.
- [x] 3.3 The city drawn, first pass (`city.ts`): buildings instanced per tile at every detail (one box and one shader:
      sandstone, ochre, rose, white, concrete and soot walls; windows, ~60% lit at night, a few flickering or cold;
      shops; a neon strip under some roofs); solid near the car. Set pieces in the city's own frame: the black river (murky
      by day, ripples fading with distance); 3,200 floating lamps drifting on it, each with a reflection streak toward the
      eye; the ghats with oil lamps on the steps and a warm glow at night, a parapet along their top (solid), chhatris; the
      barrages, lit along the crest; spires in the Nagara style (fluted, tiered, an amalaka and finial, four spirelets)
      lit from below at night, in scaffolding with floodlights and cables; broadcast towers with loudspeakers, a red
      beacon and a screen showing the state broadcast that static breaks into; three light-forms in the sky (a yantra
      after the Sri Yantra over the river, a lotus and a wheel), turning slowly, their layers turning in their plane,
      unfogged so they show from kilometres off. Paved ground, sand toward the river. A violet smog in the haze and the
      night sky near the city. A car in the river is put back on the road. The map shows the city, its river and its
      name. 60 fps through the city at night at 1920×1080 @2x, no frame over 25 ms in 60 s of autodrive; ~0.8–1M
      triangles, ~200 draws.
- [x] 3.4 The riverside expressway on stilts (C1, C2, C4, C6). Done 2026-10-31, after the user: "it doesn't look like
      the images at all, but still work on it". A `deck` road (`roads.ts`; `RoadIndex` leaves decks out unless asked, so
      the land is not carved to it) 3 m above the city, 30 m out over the water from the ghats' foot, from near one
      barrage to the other; at each end a ramp swings inland over the ghats and comes down onto the riverfront avenue
      between two lanes (the avenue is split there, so autodrive takes it). Its asphalt comes with the tiles, and so do
      guardrails both sides (the ground falls away under it). `city.ts`: the surface as a Rapier trimesh, a concrete slab,
      piers down to the riverbed or the ground every ~32 m, sodium lamps with maroon banners (a gold ring and bar) on the
      river side every ~36 m. `?place=city` and the map's button now start on it, a quarter of the way along, with the
      river on the right and the ghats on the left as in C1 (`cityStart` gives the deck's height to set the car down on).
      With it: the whole riverfront along the river is the palace model (~140, in runs of twelve so each run culls and
      casts shadows on its own; the palace simplified to 12%); the first rows of the old city keep to sandstone, ochre,
      rose and cream with no neon; spires 60–100 m tall (the model's foot sized to the spire, its height stretched); the
      yantra hangs over the river ~900 m ahead of the start, 260 m up, always facing the camera, in thinner, bluer lines.
      60 fps at 1920×1080 @2x on the expressway at night (~3.5M triangles, ~260 draws, ~3 ms of JavaScript).
      Still to do: street lamps along the city's streets; reflections in the river; the buildings behind the riverfront
      are boxes.
- [x] 3.5 Generated 3D for the city kit, first two. Studio shots made 2026-10-31 in the Prakashi file (nodes 5:2–5:4;
      masters in `art-src/prakashi/`): the shikhara (stone only: the scaffolding stays procedural), a ghat palace, a lamp
      boat. The shikhara and the palace went through Tripo H3.1 (detailed, 68 credits each) in Figma Weave on the user's
      workspace for yt.hridyesh23@gmail.com (14 credits left), then `python3 art-src/cars/process.py prakashi` (now takes
      folders; simplified to 60% and 22%: 1.6 and 1.7 MB in `public/prakashi/`). `loadCityModels` (`city.ts`) centres
      each, stands it on the ground at 1 unit tall, and gives it a node material that glows warm at night, more toward
      its foot. The six spires are the model scaled to their heights, with the scaffolding rebuilt round the model's own
      outline (its widest vertex in 50 bands); about a third of the riverfront row along the river (`blocks.ts` `palaces`,
      ~40) is the palace, 18–20 m tall, instanced, solid. If the models do not load, the procedural spires and boxes
      stand in. 60 fps on the far bank and in the streets at 1920×1080 @2x, ~2.4–2.5M triangles.
- [ ] 3.5b The lamp boat (its shot is ready), more palace variants, boats on the river.
- [ ] 3.6 Reflections of the light-forms and the palaces in the river; the far bank's industry; the story's broadcast
      (fragments by place, the pirate voice, captions; see above).
- [x] 3.7 The bridge (the user, 2026-10-31: "i am not able to drive at the bridge in prakashi"). Fixed 2026-10-31: the
      barrages' wall (crest 4 m over the city) stood across both of the expressway's ramps, which came down through it at
      ~2.2 m; autodrive hit it at 84 km/h. The ramps now keep the deck's height until they have passed over a barrage
      (`fall` in `roads.ts`), the crest is 1 m over the city (`DAM` in `cities.ts`: too high to drive onto), and no crest
      lamps stand under the ramps. Tested (the slab clears the crest) and driven end to end at 105 km/h.
- [x] 3.8 A bigger city that starts as other places do (the user, 2026-10-31: "prakashi feels so seperated out, it should
      start naturally how any other area or region is being started", then "make it a bigger city like bigger city"). It
      was a disc: a ring road, a crisp circle of paving and a wall of buildings right inside it. First pass 2026-10-31, for
      the user to judge:
      - Size: the biggest ring that fits within 40 km, of 1800, 1500 or 1300 m (spots about 2 km apart on circles 1 km
        apart). Seed 1: a 1800 m ring at (12309, 17014), 21 km from the spawn, level 83 m, the river 2.4 km long, the
        near bank a third of the ring from the middle. The land comes back over 900 m beyond the ring (was 450); a city
        must still fit, as land and level enough, out to 450 m beyond it.
      - `urban` (`cities.ts`, 0–1): full in the middle and along the ghats, thinning out over the outer 40% of the radius
        to open land before the ring, along an edge that wanders in and out (three harmonics); nothing across the river.
        Buildings keep to it, smaller and lower out there (3,000/km² in the middle, ~800 at 1.2–1.5 km, ~50 at the edge);
        the avenues give out in the open land and only the lanes run on to the ring; the ground is paved only where it is
        built up (a per-vertex `town` attribute, patched with noise), and the map likewise; trees and scrub grow in the
        outskirts (broadleaf round a city, not the upland pines) but not in its middle; inside the ring the far bank is an
        open floodplain of grass and scrub, so the skyline shows across the river.
- [x] 3.9 Buildings after Cowboy Bebop, in Kashi, with its mandirs (the user, 2026-10-31: "i wanna take inspiration from
      cowboy bebop anime ... i want those kind of buildings in kashi with the mandirs"). From the research: a neo-noir space
      western whose cities come from New York and Hong Kong (the film's Mars mixes Manhattan, Hong Kong, Tokyo, Cairo and
      Paris), worn retro technology, Art Deco, and the jazz written first. Six concepts in a new Figma draft, "puzzlecafe —
      Prakashi Bebop" (https://www.figma.com/design/EOuPwn0k4sIYg8EElTiv8O, nodes 1:2–1:7, left to right; masters
      `art-src/concepts/prakashi-bebop-c1..c6.jpg`; the first Prakashi file is not editable from the MCP's account): C1 dusk
      from the expressway, C2 a neon lane at night with a mandir, C3 rooftops at sunset (black tanks, water towers,
      scaffolded shikharas), C4 Deco towers crowned with shikharas at blue hour, C5 the city starting from the fields, C6
      flat and graphic. For the user to pick. First pass in the game 2026-10-31, from what the six share:
      - Downtown, a little inland of the middle: Art Deco towers in three setbacks, 14–43 floors, each crowned with a
        temple spire (61 on seed 1), some with a wooden water tower on the first setback.
      - Roofs: stair rooms, black water tanks on most, old wooden water towers on legs, aerials with a red light, dishes.
        Neon blade signs out over the streets, made-up letters under a headline as in Devanagari, amber, red, teal or pink,
        blazing at night. ~265 mandirs in the old city (plinth, porch, a spire with four spirelets, a saffron flag), lit
        from below at night and solid.
      - Walls: arched windows with sills, grime streaking down from the roofs; brick and an indigo wash in the palette.
      - Props are instanced per tile like the plants (`propMeshes` in `city.ts`): roof clutter and signs only within two
        chunks, crowns and mandirs at every distance. The 165 palaces (3.3M triangles) get a coarse copy beyond 450 m
        (meshoptimizer's sloppy simplifier, 8%).
      - Seed 1: 13.4k buildings, 61 towers, 17.8k tanks, 1.1k signs. Measured at 1920×1080 @2x while Brave used 120–190%
        CPU (the coast itself ran 50–55 fps then): the expressway at night 51–59 fps, downtown 60 once its tiles are in.
        Re-measure on a quiet machine.
      - Still to do: the user's pick of the six; cables across the lanes and laundry; billboard screens on the towers
        (C4); a few houses, a dhaba and power lines along the roads in (C5).

Exit: driving the first city holds 60 fps on Medium.

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
decision (the chase mode's police are the one exception, and only when it is on).

## Next steps
- Fixed 2026-10-27, the car "flying and then suddenly falling" (the user): `modelCafe` read the model's bounding box
  after `applyMatrix4` had remeasured it in metres, in place, so the terrace collider came out 15 times too big: an
  invisible slab 178 × 1.1 × 162 m over the spawn, which the car drove along and then dropped off. Same slip put the
  garage cars' headlight at the wrong spot. Also found with it: each tile's fixed body took mass from its props' and
  trunks' colliders (density 1), and Rapier's vehicle reads the ground body's own mass for grip, so the ground was
  slippery wherever a tile had props: parked cars rolled back down ramps, and grip varied tile to tile. Tile colliders
  are now massless (`addFixed` in `physics.ts`; the slope test covers it at 22% on a tile with props). Autodrive's lane
  keeping tightened with it (median 2.03 m, 95% within 2.05 m). The car is now set down 0.9 m up, not 1.2.
  `?debug` exposes `camera`, `car` and `physics` too.
- Commit the passes, the garage, the station, these fixes, the 2026-10-30 look work, the 2026-10-31 frame pacing fix and
  Prakashi (everything before them is in `a7b4422`); `art-src/cars/*.glb` and `art-src/cafes/*.glb` are 8–9 MB masters.
- Phase 2, the gaps to the concepts (see its exit check). First passes landed 2026-10-27, each to be judged against the
  concepts by the user:
  - [x] Cafés and hoardings close to the road: cafés 18 m from the centreline (34 before), so the terrace ends 3 m past
        the asphalt as in C1; hoardings 11 m (16); both pushed out by a wider road's extra half width. A POI's own road
        must now be its nearest and the back half of its pad clear of others (`pois.ts`); café and fuel signs find the
        road through the shared `SETBACK`. Same number of POIs (24 cafés, 25 stations in a 10 km square on seed 1).
  - [x] Smaller junction patches: `half + 0.5` (was `+ 2`), so no disc bulges past the far edge of a T.
  - [x] Planting up to the road: a band of shrubs 3 to 9 m off the asphalt on the 3 m ground-cover grid, thickest by
        the sea, none in desert or mountains (no colliders).
  - [x] Road lamps: street lamps (sign kind `SIGN_LAMP`) every 30 m out to ~105 m either side of each café and station,
        on its side, arms over the road, lenses lit at night; ~8 per POI, one merged steel mesh plus a lens each
        (~+45 draws near a café). No real light pool on the road yet.
  - [x] Cliffs and a coast road high above the sea. Done 2026-10-30 (`baseAt` in `fields.ts`): the coast road stands
        above the land's slope by a sea cliff (`CLIFF` 46 m times the cliffs field, now at a 6 km scale) plus the swell
        where it is up. The land rises to it from a beach (the first 12% of the shore-to-road distance, `BEACH`) as
        u^1.6, steepest just below the road, so beyond the wall the ground falls away; behind the road a hillside rises
        60% more over about a kilometre (`HILLSIDE`). Where the shore is close the rise is capped at 1.5 m per metre of
        that distance past the road's 12 m strip (`CLIFF_SLOPE`, `SHOULDER`): the old cliff rose in the first quarter
        of it, a 69° wall at the spawn that read as a striped concrete dam. The distance, COAST_C / |∇C|, comes from a
        cached 32 m lattice. Coast road heights: median 17 m, p75 51, p90 59; its grades p99 7.4%, max 10% (were 9.2,
        11.7). The road's strip meets the land over 7 m (`BLEND`, was 14), so the slope starts at the wall. Cafés and
        hoardings take the sea side only where the land there is within 4 m of the road (`pois.ts`).
        Rock: the ground shader also judges steepness per triangle (from screen-space derivatives), so a cliff one tall
        triangle wide in a far tile is rock lit by its own facet, not a blend of the grass above and the sand below;
        gullies from noise over the ground plan (it runs straight down a face), blotches, and a procedural bump near
        the camera. They replace the level strata (the 2.2 note: stripes). Warmer limestone; red rock in the desert
        through a per-vertex `arid` attribute. Maquis clings to coastal slopes up to ~58°, plants sink into slopes, and
        boulders sit in the surf.
  - [x] The midday sky's deep blue and cumulus. Done 2026-10-30 against C3 (found in an old scratch folder; C3 and C5 are
        now in `art-src/concepts/`). The visible day sky is painted with C3's measured colours, (146, 186, 224) at the
        horizon to (64, 132, 226) overhead, given as the scene colours that ACES, the sRGB encoding and the CDL grade
        turn into exactly those (`SKY` in `daylight.ts`, the chain inverted once, divided by the exposure): ours now
        lands within a few levels. The sun's disc stays; clear weather no longer greys it. Cumulus: bigger heaps down to
        the horizon, cauliflower edges, grey cores, the side toward the sun lit. The sea reflects the environment tinted
        toward that blue by day (`seaEnvironment`, back to plain by sunset, so the gold still glitters) and its long
        waves stop tilting far out, so it reads deep blue, not a pale striped pool. Summer grass is a darker olive with
        golden dry patches over most of it.
  - [x] Villages on the hills. Done 2026-10-30: `world/villages.ts` puts at most one in each 2.2 km cell (55%), on the
        coast's or the country's hills (of six spots, the one standing highest over the land 140 m around, nearer the
        sea the better), 70 m or more from roads. 16 to 44 houses within 24 + 1.9 per house metres, along the contours
        with the front downhill, clear of roads (18 m plus the footprint), POIs and each other, on slopes up to 0.5;
        one to three floors, taller in the middle. `houses.ts` is one instanced shape and shader, like the plants:
        plaster in five tints, a stone plinth for slopes, a low terracotta gable roof, windows with green or blue
        shutters, some lit at night. Every tile carries its houses at every level of detail (on its own grid's ground at
        the footprint's high corner), so villages show on far hills; near ones have colliders and plants keep clear.
        14 villages in a 20 km square around the spawn, 5 to 15 ms each, once per worker. Tested: the same every time,
        on land, clear of roads, nothing growing through them.
  - [x] Junctions, fixed 2026-10-30 (seen 2026-10-27: where arms leave a junction close together, e.g.
        `?play&at=-2559,-215,0`, `2686,-510`, they overlapped at different heights and the terrain buried one ribbon in
        2 m steps). The cause: `ease` pinned a road's ends to the land's raw height and blended toward the average
        linearly, so arms left a junction at the land's raw slope (p90 14%, max 41% within 40 m) and overlapping ribbons
        differed by up to 3 m (34 of 100 junctions over 1 m). Now each end keeps the junction's height for 20 m (at a T,
        the coast road's height beside each point, by Newton steps onto the contour), then eases onto the average over
        140 m. Junctions over 1 m apart: none (the worst 0.6 m, on a 9% coast road, under the patch); grades within
        40 m: p90 3.3%, max 13.5%; inland roads' steepest 46% → 33%.
- Generated 3D for the rest of the world (the user, 2026-10-26: cafés, stations, pumps, bookstores, signs, roads and
  trees "that accurate too"). Image-to-3D suits the four café variants, the station and its pumps, a bookstore, and a
  few hero trees near the road at a low face limit (the plants stay procedural further out, for wind, seasons and
  instancing); signs and roads stay procedural (crisp graphics; ribbons that follow the world's curves). Test café
  done 2026-10-26, the coast one: a studio shot with a blank fascia (`art-src/cafes/coast.jpg`; Figma file
  `lLdW6FA4HpbEjm0StKe8bz` node 1:2, as the second account cannot edit the art bible), then TRELLIS.2 on Hugging Face
  (`art-src/cafes/trellis2.py`, ~150 s, `HF_TOKEN` in `.env`; Weave refused, as agent runs need a paid plan): 143k
  triangles, one 2048 px PBR texture. `loadModels` (`props.ts`, awaited before the first tiles) swaps it in for the
  procedural coast café, measured once in `MODELS` (15 m a unit, from table height): the black glass panes are cut
  out for rooms of books and pendant lamps behind glass, the open middle bay's modelled room glows at night, the
  procedural sign sits on the fascia (its letters glow at night, no longer the whole board), two collider boxes.
  Softer than the Tripo cars up close (blobby plants, wobbly chairs) but it holds at road distance. The side window
  on its left wall stays black.
  Station and pump done 2026-10-27 (Trellis 2 in Weave, 30 credits each, on a third account): the station model
  (forecourt, canopy on four columns, shop whose glass shows lit shelves; the canopy's underside and the shop glow at
  night) measured in `STATION` at 20 m a unit, its islands now at ±4.6 m (`ISLAND_X`, which `atPump` reads), two
  pumps per island (`PUMP`, 1.8 m), the procedural FUEL totem; the shell is made non-metal (its map mirrored the dim
  horizon). `process.py` now packs cafés and props with gltfpack 1.3.0 (meshopt, quantized, float UVs; the loader
  unpacks them), and simplifies the pump to 25%: café 7.4 → 2.4 MB, station 1.5 MB, pump 0.9 MB.
  Bookstores are a new POI kind (`pois.ts`): halfway along countryside inland roads (roll 0.22–0.3, so cafés and
  stations did not move), 24 m back from the road, a 12 m pad, no road sign, a green "bk" badge on the map. Until
  their model is made they are the farmhouse café named "paperboxd books".
  Farmhouse done 2026-10-30 (TRELLIS.2 on Hugging Face, one clean run in 194 s): brick, a terracotta roof, three
  glass bays under a white beam, a timber deck; `MODELS.country` at 12 m a unit (tables 0.061 units over the deck), a
  room of books behind each of its three black panes, 2.5 MB packed. Every countryside café is now that farmhouse.
  Still to make, one a day on the free Hugging Face quota (generating and extracting each reserve 120 s of a ~210 s
  day; a failed call still spends it): the lodge and the desert diner (`art-src/cafes/{mountains,desert}.jpg`) and
  the bookstore (`art-src/props/bookstore.jpg`); each needs a `MODELS`-style entry, measured as these were.
- 3D queue, about two a day on the free Hugging Face quota (the user's call to buy more): the four cars left of 2.13
  (stealth, scanner, blower, hyper), then the lodge, the desert diner and the bookstore, then Prakashi's lamp boat
  (3.5b). The fastback (C2) and the white 70s coupe (C6) shots wait too.
- The user deploys the demo later (Vercel, like their other sites).
- Checking the look: comparison frames come from `?play&at=-251,619,-0.56&weather=clear&t=17.55` (C1), `t=12.5` (C3),
  `t=18.45` (C5), beside a café on a cliff stretch (the old `-3535,-207` spot is now a junction on low ground); a
  village from the coast road at `?play&at=1448,-885,-1.51`; the farmhouse at `?play&at=2623,-2060,-0.94`. Hitches: `?debug`, then read
  `puzzlecafe.slow` (each slow frame with its parts: drive, physics, world, camera, light, tiles, render).
