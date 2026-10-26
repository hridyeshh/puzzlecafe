# puzzlecafe

Read `PLAN.md` first. It has the product, the decisions, phase status and the next steps.

- Browser driving game: Vite + TypeScript + three.js (`WebGPURenderer`, WebGL2 fallback) + Rapier.
- `src/world.ts` is pure: no DOM, no renderer, no `Math.random`. The same seed must always build the same world;
  workers and `node --test` depend on it.
- Brand assets come from the sibling repos (`../paperboxd`, `../stickynotes`, `../thelocalcode` and their icon and
  design folders). Never copy their env values.
- Art goes through Figma: generate candidates, the user picks (see Art pipeline in `PLAN.md`).
- Pin dependencies to releases at least two weeks old.
- When a phase or step is finished, update its status in `PLAN.md`.
