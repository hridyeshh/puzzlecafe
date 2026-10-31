# puzzlecafe

> *An endless, calm drive through places that feel real.*

puzzlecafe is a driving game in the browser. It has the peace of slowroads.io (endless roads, a day that turns to night, weather and seasons) with richer graphics and distinct places: a Mediterranean coast, countryside, mountain passes, a desert highway, and Prakashi, a dystopian river city of light. The products of paperboxd, stickynotes and thelocalcode live in it the way brands live in the real world: a bookstore café by the road, a hoarding on a bend, a sticky note pinned to the map. Texture, not ads.

**Play:** not deployed yet (Vercel, like the other sites) · **Plan:** [`PLAN.md`](PLAN.md) · **Contact:** contact@paperboxd.in

---

## Table of Contents

- [What is puzzlecafe?](#what-is-puzzlecafe)
- [Repository Map](#repository-map)
- [System Architecture](#system-architecture)
- [How a Tile Streams In](#how-a-tile-streams-in)
- [The World (pure)](#the-world-pure)
- [Places](#places)
- [Prakashi](#prakashi)
- [Rendering](#rendering)
- [Driving and Physics](#driving-and-physics)
- [Brands in the World](#brands-in-the-world)
- [Art Pipeline](#art-pipeline)
- [Controls and URL Parameters](#controls-and-url-parameters)
- [Performance](#performance)
- [Development Setup](#development-setup)
- [Testing](#testing)
- [Known Limits](#known-limits)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)

---

## What is puzzlecafe?

Get in a car and drive. The road never ends, the clock keeps turning, and every place is built from the same seed every time.

- **Endless and seeded.** The whole world is computed from a seed as you drive: land and sea, a network of roads with junctions, villages, cafés and petrol stations. One seed always builds the same world, so a place can be shared by its coordinates.
- **Places with their own look.** The coast with its cliffs, olive groves and sea; countryside with farmhouses; mountains with passes in hairpins; desert with mesas and saguaros; and Prakashi, a city on a black river.
- **Time and weather.** One game hour every two real minutes, slower around golden and blue hour. Clear, cloudy, fog, rain and snow, a spell every few minutes; a season a game day.
- **Drive or be driven.** Keyboard or gamepad; Q hands the wheel to autodrive, which keeps its lane and picks a way at junctions. Phones start in autodrive.
- **A garage** of cars made from the concept art (B), **nitro** (Shift), and an opt-in **chase mode** (P) with police cars and a helicopter.
- **A map** (M) of anywhere, drawn without loading it: badges for cafés, bookstores and fuel, region names, travel buttons, and pins in the stickynotes highlighter colours.

### The one rule

> The world is a pure function of (seed, x, z).

Generation code (`src/world/`) imports no DOM and no renderer and never calls `Math.random`. Workers build tiles with it, the map draws any place with it, `node --test` checks it, and the main thread asks it for heights, roads and the nearest pump.

### What it deliberately doesn't do

| It doesn't | Instead |
|---|---|
| Fill the roads with traffic or traffic lights | Empty roads; only chase mode's police, when you turn it on |
| Show ads or pop-ups | Brands are places: a café, a bookstore, a hoarding, a map pin |
| Store the world | Everything is recomputed from the seed, on demand |
| Need a server | No backend; settings and pins live in localStorage |
| Ship a second game for phones | Phones are a quality tier and an input scheme: Low, autodrive first |
| Draw as fast as the screen refreshes | At most one frame per 1/60 s, so a 120 Hz screen gets an even 60 |

---

## Repository Map

```
index.html          The landing page: hero art, Start, chase mode, links to each kind of place
src/landing.ts      Loads the game only when you press Start
src/main.ts         The renderer, the loop, the car, input, fuel, HUD, rebasing, frame pacing, dynamic resolution
src/world/          The pure world (no DOM, no three.js scene, no Math.random)
  fields.ts           Continentalness, heights, hills, mountains, desert; `open` for roads
  nodes.ts            The inland road grid's nodes and edges
  roads.ts            The coast road (a contour), the grid roads, highways, city streets, RoadIndex
  passes.ts           Mountain passes in hairpins
  pois.ts             Cafés, stations, hoardings and bookstores along roads
  villages.ts         Villages on the hills
  cities.ts           Prakashi's site, its river and ghats, its ground
  blocks.ts           Prakashi's buildings, palaces, spires and towers
  chunk.ts            One 256 m chunk: carved heights, road ribbons, plants, walls, guardrails, signs
  places.ts           Biomes, region names, travel, where a drive to the city starts
  world.ts            makeWorld(seed): areas, heightAt, spawn, map data
src/tile.ts         A chunk at a level of detail, built in a worker
src/worker.ts       The tile workers (up to four)
src/streaming.ts    Tiles in and out around the car; terrain, road and wall materials; colliders
src/terrain.ts      Tile vertices, colours and skirts
src/plants.ts       Trees, scrub, grass and flowers: one instanced shader with wind and seasons
src/houses.ts       Village houses, instanced
src/city.ts         Prakashi drawn: buildings, the river, lamps, ghats, expressway, spires, light-forms
src/props.ts        Cafés, stations, hoardings, signs; loads the generated models
src/daylight.ts     Sun, moon, sky, clouds, fog, stars; the `night` and `smog` uniforms
src/ocean.ts        The sea: Gerstner waves, depth colour, foam
src/weather.ts      Weather and seasons
src/physics.ts      Rapier: terrain colliders and the car
src/car.ts          The garage's cars and the procedural roadster
src/autodrive.ts    Lane keeping and choosing a way at junctions
src/chase.ts        Chase mode's rules and police AI (pure of three.js)
src/police.ts       Police cars and the helicopter, drawn
src/garage.ts       The garage hall
src/map.ts          The map; src/mapworker.ts draws its tiles
src/hud.ts          Speed, fuel, nitro, clock, stars, hints, the controls card
src/audio.ts        Engine, wind, tyres, surf, siren and rotor, all synthesised
public/             Landing art, brand posters, cars, cafés, props, Prakashi's models
art-src/            Masters: concepts, posters, studio shots and generated models, processing scripts
PLAN.md             Decisions, phase status, measurements and next steps
CLAUDE.md           Notes for coding agents
```

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Main thread                                                                          │
│                                                                                      │
│  input · autodrive · chase ──► Rapier (fixed 1/60 s steps) ──► car, police           │
│                                                                                      │
│  streaming.ts ◄── finished tiles          map.ts ◄── map tile bitmaps                 │
│      │ meshes, plants, houses,               │ pans and zooms only move pictures      │
│      │ city buildings, colliders             │                                        │
│      ▼                                       │                                        │
│  three.js WebGPURenderer (WebGL2 fallback): scene pass (MSAA) ► bloom ► grade         │
│  at most one frame per 1/60 s · dynamic resolution                                   │
└───────────────┬───────────────────────────────────────────────┬──────────────────────┘
                │ { seed, cx, cz, lod }                          │ { seed, x0, z0, m, px }
                ▼                                                ▼
┌───────────────────────────────────────┐   ┌──────────────────────────────────────────┐
│ Tile workers (up to 4)                │   │ Map workers (2)                          │
│ buildTile: heights, ribbons, plants,  │   │ land, sea, city and roads on an          │
│ walls, signs, houses, city buildings  │   │ OffscreenCanvas; badges as points        │
└───────────────────┬───────────────────┘   └─────────────────────┬────────────────────┘
                    └──────────────┬──────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ src/world/: makeWorld(seed). Pure functions of (seed, x, z), cached by area.          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Floating origin.** World positions are float64 in JavaScript; meshes and physics sit relative to an origin that jumps a chunk at a time once the car is 1 km out, so float32 never sees big numbers. A tile's colliders hang off one fixed body, so a rebase moves one body, not thousands.
- **One shader per kind.** Plants, houses and city buildings are plain meshes with instanced attributes sharing one shader each (three.js would compile a shader per `InstancedMesh`). Everything that streams in later is compiled behind the landing page.

---

## How a Tile Streams In

1. **Asked for.** Each frame `streaming.ts` lists the chunks around the car that are missing or at the wrong detail, nearest first, and gives them to idle workers.
2. **Built in a worker.** `buildTile` samples the chunk: at full detail (2 m) with roads carved in, road ribbons, plants, stone walls and guardrails, signs, POIs, village houses and city buildings; coarser tiles (8 m, 16 m) carry the land, houses and buildings so distant hills and the skyline still show.
3. **Sent back** with its typed arrays transferred, not copied.
4. **Placed** under a 6 ms per-frame budget: terrain and road meshes, props, instanced plants, houses and buildings, and, at full detail, a heightfield and colliders for trunks, walls, signs, houses and buildings.
5. **Dropped** when the car moves on: meshes disposed, the tile's body removed with its colliders.

Levels of detail: 2 m within two chunks (roads, props, plants, colliders), 8 m out to five, 16 m out to nine (about 2.4 km). Fog closes at the edge.

---

## The World (pure)

| Piece | What it decides |
|---|---|
| Fields | Continentalness (sea below 0), a road-safe height with sea cliffs and a beach, hills, mountain ranges (30 km noise) and deserts (34 km) |
| The coast road | The C = 0.05 contour, traced by marching squares on a world-aligned grid, so neighbouring chunks agree |
| Inland roads | A jittered 1 km grid; every third line a highway (straighter, wider, shoulders); edges end on the coast road in T-junctions; heights eased so grades stay gentle |
| Mountain passes | Some mountain edges climb over a ridge in hairpins at 8.5%, the land levelled under them |
| POIs | Cafés, stations and hoardings where the coast road crosses 640 m lines; along inland roads, a station, café or bookstore halfway, hoardings a quarter in |
| Villages | At most one per 2.2 km cell, on the hill highest over its surroundings, houses along the contours |
| Places | Biome per point, region names per ~9 km cell, travel to the nearest road of a kind |
| Prakashi | One city per seed; see below |

The terrain is carved to the roads: a flat strip under each road, hills fading back in over 140 m, pads under cafés and stations. `heightAt(x, z)` equals the meshes at their vertices.

---

## Places

| Place | What makes it |
|---|---|
| Coast | Sea cliffs and beaches, the coast road high above the sea, olives, cypresses and maquis, dry-stone walls, villages on the hills, a deep blue sea that turns turquoise over sand |
| Countryside | Rolling hills, woods, farmhouse cafés, bookstores |
| Mountains | A long climb into ranges with ridged peaks, conifers to the tree line, snow, passes in hairpins, mountain-lodge cafés |
| Desert | Dunes, red rock, flat-topped mesas, saguaros, diners |
| Prakashi | A dystopian river city after Kashi; night first |

The map's buttons (and `?place=coast|country|mountains|desert|city`) start a drive at the nearest road of that kind, at the same hour and season.

---

## Prakashi

The first of the cities of Phase 3, Indian cities under fictional names, each with its own twist. Prakashi is a dystopian river city of light. Its art direction is six concepts in the Figma file "puzzlecafe — Prakashi"; C1 (night on the riverside expressway) is the one the game is built toward.

- **Where.** One per seed, placed at the first spot ringing out from the origin where a whole city fits on land clear of the coast road, not in the mountains or the desert. On seed 1 it is 15 km from the spawn. The map shows it; its button (or `?place=city`) starts on the expressway.
- **The ring road.** Inland roads end on it in T-junctions, exactly as they end on the coast road: inside the ring, continentalness as roads see it is as if the sea.
- **The river.** A black crescent 280 m wide and 1.85 km long, held by barrages at both ends, 3,200 floating lamps drifting on it, each with a reflection streak.
- **The ghats.** Fourteen broad steps down to the water with oil lamps and small domed pavilions, a parapet along their top, and palaces along the riverfront (a generated model, glowing warm at night).
- **The expressway on stilts.** Over the water along the ghats, piers down to the riverbed, sodium lamps with banners; ramps at each end come down to the riverfront avenue.
- **Streets and buildings.** Avenues in arcs along the river, lanes out from it, every crossing a junction for autodrive. About 12,000 buildings: the old city in sandstone, ochre and rose by the river, concrete and neon further out.
- **Spires and towers.** Six temple spires (a generated model) in scaffolding with floodlights and cables; broadcast towers with loudspeakers and a screen where the state broadcast keeps breaking into static.
- **The sky.** Light-forms, never deities: a yantra over the river that always faces you, a lotus and a wheel that turn. A violet smog hangs in the haze near the city.

---

## Rendering

- three.js `WebGPURenderer` with its WebGL2 fallback (`?webgl` forces it); materials written in TSL.
- Bloom on bright things (the sun on the water by day, lamps and windows at night), ACES tone mapping, then a colour grade and vignette like the concept art.
- The sky: a sky model repainted toward the concept's blue by day, fractal cumulus, a violet blue hour, stars; the environment is re-baked into the same target as the sun moves (a new one would recompile every material).
- Fog takes the colour of the sky behind it; haze thickens at dawn and dusk, in mist and rain, and in a city's smog.
- Quality presets: `?q=low|medium|high` (pixel ratio 1, 1.5, 2; shadows off, 2048, 4096; tiles out to 6, 9, 9 chunks). Medium on computers, Low on phones and tablets.
- MSAA: 4 samples at a pixel ratio of 1, 2 above it.

---

## Driving and Physics

- **Rapier** (`@dimforge/rapier3d-compat`): a raycast vehicle on a fixed 1/60 s step, interpolated for drawing. Terrain is one heightfield per full-detail chunk; trunks, walls, guardrails, signs, buildings and the expressway's deck are solid.
- **Fuel** lasts about 45 km; empty, the car limps at 20 km/h. Stop beside a pump island and hold F. `Z` (or `?zen`) makes it endless.
- **Nitro**: Shift with the throttle down, about 4 s, refilling over 20 s.
- **Autodrive** pursues the right lane, slows for bends and passes, and at a road's end picks a way (or the way toward a target: the police use it).
- **Chase mode** (P, or `?chase=easy|normal|hard`): police cars (the garage's cars in police paint), then a helicopter with a searchlight; break their line of sight to escape, stop beside one and you're busted.
- A car that ends up in the sea or the river is put back on the nearest road.

---

## Brands in the World

| Brand | In the world |
|---|---|
| paperboxd | Bookstore cafés with a variant per place (a stone café on the coast, a farmhouse, a mountain lodge, a desert diner), bookstores in the countryside, hoardings, signs before each café |
| stickynotes | Map pins in the extension's four highlighter colours (yellow, pink, blue, green); click a road to pin it, click a pin to drive there |
| thelocalcode | Posters composed from the studio's own assets and words |

Hoardings come in two formats (a roadside 48-sheet and a highway unipole). A new product is a registry entry in `src/brands.ts` plus its creatives.

---

## Art Pipeline

1. **Concepts in Figma.** About six candidates per place (GPT Image 2.5 through the Figma MCP); the user picks. Masters in `art-src/concepts/`.
2. **Studio shots.** One clean shot per object: isolated, three-quarter view, plain grey, no text.
3. **Image-to-3D.** Tripo H3.1 in Figma Weave (68 Weave credits a detailed model; agent runs need a Weave account with free runs or a paid plan), Tripo's API (`art-src/cars/tripo.py`, credits bought on platform.tripo3d.ai), or TRELLIS.2 on Hugging Face (`art-src/cafes/trellis2.py`, about two a day on the free quota, `HF_TOKEN` in `.env`).
4. **For the web.** `python3 art-src/cars/process.py [folder ...]` cuts textures to 2048/1024 px JPEG and packs cafés, props and Prakashi's models with gltfpack (meshopt, some simplified) into `public/`.
5. **In the game.** Each model is measured once (scale, glass, decks, axles) and gets an entry in `props.ts`, `car.ts` (`GARAGE`) or `city.ts`; the procedural version stays as the fallback.

Ground and rock are procedural; signs and roads stay procedural so they follow the world's curves.

---

## Controls and URL Parameters

| Key | Does |
|---|---|
| W S, ↑ ↓ | Throttle, brake / reverse (Space brakes too) |
| A D, ← → | Steer |
| Shift | Nitro |
| Q | Autodrive on or off (any drive key takes over) |
| F | Refuel, held beside a pump |
| M | Map (Esc closes) |
| B | Garage (← → browse, Enter drives) |
| P | Chase mode on or off |
| C | Chase or hood camera |
| T / N / G | Skip an hour / next weather / next season |
| Z | Zen: endless fuel |
| V | Sound on or off |
| R | Back on the wheels |
| H | The controls card |

A gamepad drives too (stick to steer, triggers for throttle and brake, A for nitro).

| Parameter | Does |
|---|---|
| `?play` | Skip the landing page |
| `?at=x,z,yaw` | Start there |
| `?place=coast\|country\|mountains\|desert\|city` (`&from=x,z`) | Start on the nearest road of that kind |
| `?t=17.5` | Start at that hour |
| `?weather=clear\|cloudy\|fog\|rain\|snow`, `?season=spring\|summer\|autumn\|winter` | Start in it |
| `?car=coupe\|roadster\|interceptor\|armoured` | Drive that car (also `champagne\|green\|silver\|red`, the procedural roadster) |
| `?chase=easy\|normal\|hard` | Chase mode on |
| `?q=low\|medium\|high`, `?shadows=0`, `?webgl` | Quality, no shadows, WebGL2 |
| `?zen`, `?fuel=0.3`, `?auto`, `?cruise=30` | Endless fuel, start low, start in autodrive, autodrive's speed in m/s |
| `?seed=2` | Another world |
| `?debug` | fps, draw calls, triangles, tiles, resolution, position; a log of slow frames in `puzzlecafe.slow` |

---

## Performance

The target is 60 fps on Medium. Measured on an M4 MacBook Air in Chrome at 1920×1080 @2x (Medium draws 2880×1620):

| Where | fps | Notes |
|---|---|---|
| The coast at golden hour | 60 | ~1.5M triangles, ~250 draws; 86 fps with the frame cap off |
| A sunset drive in chase mode | 59.8 | |
| Prakashi's expressway at night | 60 | ~3.5M triangles, ~260 draws, ~3 ms of JavaScript a frame |
| Autodrive through Prakashi's streets at night | 60 | no frame over 25 ms in 60 s |

What keeps it there: the 60 fps cap (on a 120 Hz screen a GPU that manages 70–110 fps shows frames at uneven intervals, which reads as stutter), dynamic resolution that backs off when frames run long and stays off a scale that proved too slow for a minute, shaders compiled behind the landing page, tiles placed under a per-frame budget, and one shader per kind of instanced thing.

---

## Development Setup

Requirements: Node 25 (the tests run TypeScript directly), Chrome or another browser with WebGPU (WebGL2 works as a fallback).

```bash
npm install
npm run dev        # Vite on http://localhost:5173 (?play&debug skips the landing and shows the overlay)
npm run build      # tsc, then vite build into dist/
npm run lint       # oxlint
npm test           # node --test
```

Dependencies are pinned to releases at least two weeks old. `.env` holds `HF_TOKEN` and `TRIPO_API_KEY` for the art scripts only; the game needs no secrets.

---

## Testing

`npm test` runs four `node --test` suites, with no browser and no framework:

| Suite | Covers |
|---|---|
| `src/world/world.test.ts` | One seed, one world; seams between chunks; the spawn on the coast road, no road in the sea; roads on the terrain; POIs on land and clear of junctions; villages; mountain passes at road grades; Prakashi (level, its river, country roads ending on its ring, streets and buildings clear of the river, the expressway over the water) |
| `src/physics.test.ts` | Colliders match the chunk heights; a parked car holds on a 22% slope; throttle, steering, brake and reverse |
| `src/autodrive.test.ts` | Slowing for a side road it takes, keeping going past one it skips |
| `src/chase.test.ts` | A chase on real terrain: the police come and bust a stopped car; out of sight long enough, it escapes |

The look and the frame rate are checked in Chrome with `?debug`: comparison frames at fixed `?at=` spots and times against the concepts, and soak runs that log every frame over 25 ms with where its time went.

---

## Known Limits

- **Not deployed yet.** The demo link waits on a Vercel deploy.
- **Phones** have been tried only in Chrome's emulation (390×844, touch), where they boot at Low and autodrive at 60 fps.
- **Prakashi is a first pass.** No reflections of the city or the light-forms in the river yet, the far bank is empty sand, the buildings behind the riverfront are boxes, and the city's story (its broadcast and a pirate voice) is still to come.
- **Generated 3D runs are rationed.** Weave's agent runs need an account with free runs or a paid plan; the free Hugging Face quota allows about two models a day. Four garage cars, three cafés, a bookstore and Prakashi's lamp boat wait in the queue (see `PLAN.md`).
- **A hard chase** with five police cars and the helicopter can dip to 51–55 fps for a few seconds at 1920×1080 @2x.

---

## Troubleshooting

| Problem | Try |
|---|---|
| "needs WebGPU or WebGL 2" | A recent Chrome, Edge or Safari; `?webgl` forces the WebGL2 path |
| Stutter | `?debug`: if `res` is low the GPU is behind (try `?q=low` or a smaller window); `puzzlecafe.slow` in the console lists slow frames and what took the time |
| The car is stuck or upside down | R |
| Lost | M, then a travel button or one of your pins |
| No sound | Sound starts on the first key or click; V toggles it |

---

## Documentation

| File | Contents |
|---|---|
| [`PLAN.md`](PLAN.md) | Product, decisions, every phase and step with its status and measurements, next steps |
| [`CLAUDE.md`](CLAUDE.md) | Notes for coding agents: read `PLAN.md` first, keep `src/world/` pure, art through Figma |
| `art-src/` | Masters and the scripts that turn them into what is in `public/` |

---

## Contact

contact@paperboxd.in
