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

### Phase 0: foundation and art direction (built 2026-10-26; waiting on the user)
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

Needs the user:
- Drive it (`npm run dev`, then http://localhost:5173/?debug) and say how the car feels.
- Pick the art direction (one of C1 to C6, or a mix).

Notes for phase 1:
- The build is one 5.2 MB file, mostly Rapier's compat build inlining its wasm as base64. Lazy-load the game behind
  the landing page; consider `@dimforge/rapier3d` with a separate .wasm file.
- The car spawns on the flattest point within 200 m of the origin; phase 1 spawns it on a road.
- The Claude in Chrome extension and the Playwright MCP bridge were not connected, so browser checks ran through
  `playwright-core` from `../thelocalcode` driving the system Chrome.

### Phase 1: vertical slice, "Coastal Drive" (pending)
The whole vision in one place.
- World: hashing, coast and countryside, the road graph, carving, POIs. Tests: same seed same world, road height equals
  terrain at the road centre, no roads in the sea.
- Streaming: chunk rings built in a worker pool, LOD with skirts.
- Render: splatted terrain, road ribbons and junction patches, ocean (Gerstner waves, fresnel, foam), sky with day and
  night, fog, instanced trees and grass, shadows, tone mapping and bloom; Low, Medium and High presets.
- Car: autodrive (keeps its lane, takes random turns), keyboard and gamepad.
- Brands: the registry, two hoarding formats, one paperboxd café.
- Play: fuel, pumps and refuelling; the map (M) with roads, POIs and the player; HUD with speed, fuel and clock; engine
  and wave audio.
- Site: a landing page; the game bundle loads only when play starts.

Exit: 30 minutes of autodrive with no gaps or hitches; 60 fps on Medium; all three brands seen in the first five
minutes; it boots on one recent phone at Low (a smoke test only); a demo link to share.

### Phase 2: more places (pending)
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
More vehicles, photo mode, tunnels and bridges, interiors, multiplayer, shared sticky notes. No traffic and no traffic
lights, by decision.

## Next steps
- The user drives the phase 0 build and picks an art direction; then phase 1.
