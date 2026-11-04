# Graph Report - heli-supply  (2026-11-03)

## Corpus Check
- Corpus is ~31,751 words - fits in a single context window. You may not need a graph.

## Summary
- 479 nodes · 1350 edges · 17 communities (12 shown, 5 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 168 edges (avg confidence: 0.85)
- Token cost: 53,898 input · 0 output

## Community Hubs (Navigation)
- Main Loop, Audio & UI
- Config & World Generation
- Progression & Save
- Input, Bindings & i18n
- Physics & Props
- Game Design (README)
- Economy & Delivery Pay
- Helicopter Defs & Model
- Package Dependencies
- Contracts & Sites
- Crate Lifecycle
- Heli Runtime & Damage
- TypeScript Config
- Sling Hook & Upgrades
- Flight Control Step
- Camera Rig
- Airdrop Predictor

## God Nodes (most connected - your core abstractions)
1. `Game` - 57 edges
2. `Progress` - 36 edges
3. `t()` - 32 edges
4. `Heli` - 31 edges
5. `CrateManager` - 26 edges
6. `money()` - 24 edges
7. `Props` - 23 edges
8. `UpStats` - 18 edges
9. `Site` - 17 edges
10. `Physics` - 16 edges

## Surprising Connections (you probably didn't know these)
- `MinimapData` --references--> `Site`  [EXTRACTED]
  src/ui/hud.ts → src/world/sitePlan.ts
- `index.html App Shell` --implements--> `Supply Run (game)`  [INFERRED]
  index.html → README.md
- `index.html App Shell` --conceptually_related_to--> `Vite + TypeScript + three.js + Rapier (WASM)`  [INFERRED]
  index.html → README.md
- `Game` --references--> `CameraRig`  [EXTRACTED]
  src/main.ts → src/camera/cameraRig.ts
- `Achievement` --references--> `SaveData`  [EXTRACTED]
  src/core/progress.ts → src/core/state.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Crate Delivery Methods** — readme_set_down, readme_airdrop, readme_hot_drop, readme_parachute_drop, readme_crate_break_height [EXTRACTED 1.00]
- **Economy and Progression Loop** — readme_progression, readme_fob, readme_prestige_redeploy, readme_reward_bonuses, readme_casino [INFERRED 0.85]

## Communities (17 total, 5 thin omitted)

### Community 0 - "Main Loop, Audio & UI"
Cohesion: 0.07
Nodes (16): Sfx, Particles, Crate, money(), setLang(), t(), Game, Hud (+8 more)

### Community 1 - "Config & World Generation"
Cohesion: 0.06
Nodes (56): #game canvas, index.html App Shell, #hud / #overlay / #toasts / #loading containers, @dimforge/rapier3d-compat, three, BOUNDARY, CELL, CRATE_MASS (+48 more)

### Community 2 - "Progression & Save"
Cohesion: 0.09
Nodes (20): baseLevelFor(), prestigeGain(), upgradeCost(), xpForLevel(), Achievement, ACHIEVEMENTS, Progress, ProgressUI (+12 more)

### Community 3 - "Input, Bindings & i18n"
Cohesion: 0.09
Nodes (26): clamp(), AXIS_ACTIONS, AxisAction, AxisBinding, Bindings, BUTTON_ACTIONS, ButtonAction, ButtonBinding (+18 more)

### Community 4 - "Physics & Props"
Cohesion: 0.15
Nodes (8): Physics, yawQuat(), boxGeo, cylGeo, mat(), matCache, prismGeo, Props

### Community 5 - "Game Design (README)"
Cohesion: 0.09
Nodes (26): Airdrop (predicted impact arc, green/amber/red marker), Casino Slot Machine (~95% RTP), Contracts (FOB/depot to outpost drop zone), Controls (Keyboard/Mouse/Gamepad), Crate Break Height Setting (4-80 m, default 40), Helicopter Component Damage (hull, engine, main/tail rotor, skids), Delivery Methods, Flight Models (+18 more)

### Community 6 - "Economy & Delivery Pay"
Cohesion: 0.11
Nodes (19): SfxName, REGION_PAY, WEIGHT_PAY, BASE_THRESHOLDS, basePay(), DeliveryInput, DeliveryResult, deliveryXp() (+11 more)

### Community 7 - "Helicopter Defs & Model"
Cohesion: 0.12
Nodes (19): HeliDef, HELIS, Paint, PAINTS, COMPONENTS, HitEvent, _q, _qa (+11 more)

### Community 8 - "Package Dependencies"
Cohesion: 0.12
Nodes (18): dependencies, @dimforge/rapier3d-compat@0.14.0, three@0.170.0, devDependencies, @types/three@0.170.0, typescript@5.6.3, vite@5.4.11, name (+10 more)

### Community 9 - "Contracts & Sites"
Cohesion: 0.20
Nodes (5): Contracts, Bucket, Site, SiteBuilder, SiteVisual

### Community 12 - "TypeScript Config"
Cohesion: 0.17
Nodes (11): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, resolveJsonModule, skipLibCheck (+3 more)

### Community 14 - "Flight Control Step"
Cohesion: 0.25
Nodes (3): approach(), envelope(), ControlState

## Knowledge Gaps
- **11 isolated node(s):** `wrangler.jsonc`, `Sling Hook / Cargo Bay`, `Set-down Delivery`, `Hot Drop (>20 m/s, x1.5 pay)`, `Translational Lift` (+6 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 97 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `index.html App Shell` connect `Config & World Generation` to `Game Design (README)`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **What connects `wrangler.jsonc`, `Sling Hook / Cargo Bay`, `Set-down Delivery` to the rest of the system?**
  _11 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Main Loop, Audio & UI` be split into smaller, more focused modules?**
  _Cohesion score 0.07484629778134189 - nodes in this community are weakly interconnected._
- **Why does `Game` connect `Main Loop, Audio & UI` to `Config & World Generation`, `Progression & Save`, `Input, Bindings & i18n`, `Contracts & Sites`, `Crate Lifecycle`, `Heli Runtime & Damage`, `Flight Control Step`, `Camera Rig`, `Airdrop Predictor`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Should `Config & World Generation` be split into smaller, more focused modules?**
  _Cohesion score 0.05789009697325889 - nodes in this community are weakly interconnected._
- **Why does `Supply Run (game)` connect `Game Design (README)` to `Config & World Generation`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Should `Progression & Save` be split into smaller, more focused modules?**
  _Cohesion score 0.08549019607843138 - nodes in this community are weakly interconnected._