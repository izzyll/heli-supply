# Supply Run

A browser 3D helicopter logistics game: fly, hook crates, airdrop supplies, upgrade, and grow your base.
Built with Vite + TypeScript + three.js, with Rapier physics (WASM).

## Run

```
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

## Deploy (static)

`npm run build` outputs a fully static site in `dist/` with relative paths, so it works from any host or subfolder.

- **Cloudflare Pages:** build command `npm run build`, output directory `dist`.
- **Cloudflare Workers (static assets):** `npm run build && npx wrangler deploy` (uses `wrangler.jsonc`).

## Controls

| Action | Keyboard / mouse | Gamepad (standard) |
|---|---|---|
| Collective up / down | W / S (or Space / X) | Left stick Y |
| Pedals (yaw) | A / D | Left stick X |
| Cyclic (pitch / roll) | Mouse (click to capture) or arrow keys | Right stick |
| Hook crate (sling) | F | X |
| Release crate (sling first, then bay) | E | A |
| Arm parachute | P | B |
| Release flares | Q | bindable in Settings |
| Camera 1st / 3rd person | V | Y |
| Base menu (landed on FOB pad) | B | RB |
| Map | M | Back |
| Flight model (Assisted / Realistic) | G | bindable in Settings |
| Recovery to FOB (hold) | R | LB |
| Look around / zoom | Right-drag / wheel | — |

**HOTAS:** open Settings, then click **Bind** next to an axis or button and move that control. Multiple devices are supported (for example a separate stick and throttle), with per-axis invert, a deadzone, and an expo curve. A live axis monitor helps you identify each control.

## Gameplay

**Tutorial:** the first time you press Start, an illustrated six-step "How to play" walkthrough covers the controls, cargo, delivery methods, troops, SAM sites and flares, and the base. You can open it again any time with **📖 How to play** on the start screen.

**Contracts**
- Pick up crates at the FOB or a depot.
- Either land on the pad to load them into the bay, or hook one on the sling.
- Deliver them to an outpost's drop zone.

**Delivery methods**
- **Set-down:** land in the zone, or lower the sling crate gently and release. This is the safest method.
- **Airdrop:** released crates keep the helicopter's velocity. Watch the predicted impact arc and marker:
  - **Green:** safe.
  - **Amber:** the crate will be damaged.
  - **Red:** the crate will break.
- **Hot drop:** a low, fast release (over 20 m/s) earns ×1.5 pay, at the risk of damaging the crate.
- **Parachute drop:** needs the upgrade, and the release must be above 18 m. The crate descends slowly but drifts with the wind.

**Troop deployment**
- From pilot level 2, about 30% of contract offers move soldiers (2–8) instead of crates. They are marked 👥 and "Must land".
- Land on the pickup pad and soldiers board one at a time. You get 4 seats per bay slot, so the scout carries 4.
- Land on the outpost pad and they get off. Soldiers can't be airdropped or carried on the sling.
- Each soldier pays 0.35× a crate run, so a full load pays 1.4×.

**Enemy air defence (SAM sites)**
- After about 8 deliveries, SAM sites start appearing near outposts and along supply routes in unlocked regions. One more is added every 6 deliveries.
- Each site's range, lock-on speed and missile damage grow with total deliveries and with the region. From 120 deliveries, or in region 4, they fire two missiles.
- A site has to keep its radar on you for a few seconds before it can fire. The HUD shows `SAM RADAR TRACKING %`, then `MISSILE LOCK`, then `MISSILE INBOUND` with a direction.
- Flying low behind hills breaks line of sight, and landing makes you invisible to them.
- Known sites show on the map (M) with their range ring. The minimap shows nearby sites, and the Radar upgrade extends how far it shows them.

**Flares (countermeasures)**
- Press Q to pop a pair of flares. Any radar tracking you loses its lock. Each missile already in the air has a 65% chance (+5% per upgrade tier) of chasing a flare instead.
- Flares are ammo: buy them in the Hangar's Countermeasures section at the FOB. You start with 4.
- The **Flare dispenser** upgrade adds 4 slots per tier and improves the decoy chance.

**Crate break height** (Settings, 4–80 m, default 40 m): the free-fall height at which an unpadded crate breaks. Lower drops do proportionally less damage. The original tuning was 4 m.

**Flight models** (Settings or G)
- **Assisted** (default): the stick sets a bank / pitch angle (max ~32°) and the helicopter levels itself, holds altitude when tilted, and damps climbs and descents. Optional hover-assist upgrade.
- **Realistic**: the collective is an absolute **lever** that stays where you leave it. W/S move it; a bound HOTAS throttle maps straight to it, with about half = hover and the bottom = the helicopter drops. The stick sets a pitch / roll **rate** with no auto-level, so release the stick to hold an attitude. Authority fades near the attitude limits (about 70° nose-down, 80° nose-up and 75° bank) and the airframe is pushed back, so it cannot loop or flip. At extreme tilt the rotor unloads and the helicopter drops fast. Lift increases with airspeed (translational lift). Pulling up at speed makes the rotor act like a wing, trading speed for height (zoom climb / J-hook). Climbing costs thrust, fast descents gain lift from air rushing up through the rotor, and the nose weathervanes into the relative wind. Hover assist is disabled.

**Helicopter physics and damage**
- The helicopter is a rigid body with separate damage for the hull, engine, main rotor, tail rotor, and skids.
- Rotor strikes, hard landings, collisions, and ditching in water all cause damage.
- A damaged tail rotor makes the helicopter spin, and a damaged engine loses lift.

**Progression**
- Pilot levels unlock new regions, heavier cargo, and bigger helicopters.
- There are 12 multi-tier upgrades.
- The FOB grows as you deliver crates and pays passive income, including while you're offline.
- Other rewards: streak multipliers, lucky ×3 deliveries, bullseye bonuses, daily bonuses, supply caches, and achievements.
- **Prestige (Redeploy):** trade a run for Medals, which give permanent earnings bonuses and buy paint jobs.

**Casino**
- A three-reel slot machine with a jackpot, using in-game cash only.
- Return to player is about 95%.
- You earn a free spin every 5 deliveries.

**Language:** English and Spanish (switch in Settings or on the start screen).

**Save:** progress is saved to `localStorage` automatically.
