Yes — this should be designed as a **simulation-to-video content engine**, not a normal game. The key is to make the fight logic **data-driven**, seed-based, replayable, and exportable.

## Recommended technical direction

Use this stack:

| Layer                         | Recommended Stack                         | Purpose                                                                  |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| Simulation + rendering engine | **Godot 4**                               | Robot arena, physics, dice rolls, weapons, visual effects, replay/export |
| Game logic language           | **GDScript first**, C# later if needed    | Faster iteration, easier Godot Web export                                |
| Developer portal              | **Next.js / React**                       | Internal portal to configure fights, preview seeds, trigger exports      |
| Backend API                   | **Node.js + TypeScript**                  | Save configs, trigger Godot export jobs, manage videos, publish later    |
| Video encoding                | **FFmpeg**                                | Convert raw Godot output to Instagram Reels format                       |
| Optional video overlay layer  | **Remotion**                              | Captions, title cards, winner screen, intro/outro overlays               |
| Storage                       | **S3 / Cloudflare R2 / Supabase Storage** | Store generated videos and assets                                        |
| Publishing                    | **Instagram Graph API**                   | Upload/publish Reels later                                               |

Godot is still my recommended core engine because it supports command-line movie generation with `--write-movie`, custom resolution, and `--fixed-fps`; the same docs also note that `--write-movie` and `--fixed-fps` are available in exported projects. That maps well to your “preview first, export only when I click export” workflow. ([Godot Engine documentation][1]) Godot also supports command-line export workflows, useful when you later automate build/render jobs. ([Godot Engine documentation][2])

## Core product concept

The app should have two modes:

```text
Simulation Mode
Preview the fight, test seed, tune robots, weapons, arena, and speed.

Export Mode
Lock the seed/config, render the full fight, encode to vertical video, and save/export.
```

The portal is not the public game. It is an **internal content control room** where you generate hype fights, review them, and only export the good ones.

## Fight model

The simulator should not be hardcoded as “Robot A vs Robot B”. Design it as:

```text
N robots
N teams or free-for-all
each robot has:
  name
  class
  stats
  movement dice
  weapon dice
  arsenal
  behavior profile
  visual style
```

For MVP, use **1v1**, but the internal model should already support:

```text
1v1
2v2
free-for-all
boss vs multiple robots
team battle
survival mode
```

This avoids rewriting the system later.

## Dice-based action system

Each robot should have two main dice systems:

### 1. Movement dice

Every 1–2 seconds, each robot rolls a movement action.

Examples:

```text
Strafe left
Strafe right
Boost forward
Boost backward
Drift diagonally
Hold position
Evade projectile
Orbit target
Dash behind target
Boundary recovery move
```

Movement should be relative to the current target, because you want robots to always face their opponent.

### 2. Weapon dice

Every 1–2 seconds, each robot also rolls from its arsenal.

Examples:

```text
Ray gun
Missile
Homing missile
Boomerang blade
Chainsaw dash
Laser beam
Shotgun burst
Mine drop
Energy shield
EMP pulse
Grappling hook
Flame thrower
Railgun
Drone summon
Gravity bomb
Ricochet bullet
```

Each weapon should be defined by data, not code-only logic:

```text
weapon name
weapon type
range
damage
projectile speed
homing strength
cooldown
hit effect
visual effect
sound effect
rarity
counterplay behavior
```

That gives you a scalable arsenal system.

## Arena and physics

The first visual style should be:

```text
top-down / 2.5D pixel art
box arena
visible boundary
zero-gravity floating movement
robots always aiming at target
projectiles and weapons using simple but readable physics
```

Physics should feel like space combat:

```text
inertia
sliding
drag
boost impulse
wall bounce or boundary pushback
homing projectile curves
missile acceleration
boomerang return path
knockback on hit
```

Keep the robots simple and cute/cartoonish. The visual excitement should come from weapons, movement trails, hit effects, explosions, camera shake, and UI.

## Asset generation strategy

Do **not** start with real-time AI asset generation inside the simulation. That will make the system unstable and inconsistent.

Use this approach instead:

### MVP asset method

Use a **procedural sprite kit**:

```text
robot bodies
robot heads
arms
weapon mounts
color palettes
eye styles
thrusters
weapon sprites
projectile sprites
explosion effects
```

Then generate robots by combining parts.

This gives you consistent pixel-art style, fast rendering, and deterministic outputs.

### Later asset generation

Add an **asset generation pipeline**:

```text
prompt → generate candidate sprite → review → approve → store in asset library → use in simulation
```

AI-generated assets should be approved and cached before they enter the simulator. Do not generate fresh weapons or robot sprites during every fight unless you are okay with slow, unpredictable exports.

## Developer portal requirements

The portal should feel like a “fight lab”.

It should include:

```text
Seed input
Random seed button
Robot count
Team/free-for-all setting
Robot class selector
Robot name editor
Arsenal editor
Movement dice editor
Weapon dice editor
Arena selector
Simulation speed slider
Export speed / FPS setting
Preview button
Export Reel button
History of generated fights
Winner/result metadata
```

The most important UX principle:

```text
Preview should be fast.
Export should be high quality.
```

So the portal can run the Godot Web preview in-browser. Godot supports HTML5/Web export for browser play, although it requires WebAssembly and WebGL 2.0 support. ([Godot Engine documentation][3])

For final video export, use the backend/native Godot runner instead of relying on browser recording.

## Export pipeline

The export process should be:

```text
1. User selects seed/config in portal
2. Backend stores locked fight config
3. Backend starts Godot export job
4. Godot renders fixed-FPS video
5. FFmpeg converts it to Instagram Reels format
6. Portal displays final MP4
7. User can download or publish later
```

For Instagram publishing, the clean later-stage flow is:

```text
upload MP4 to public storage
create Instagram media container
poll processing status
publish container
```

Meta’s Instagram platform documentation covers content publishing, while the IG media endpoint documentation notes that video uploads are asynchronous and return a container ID used for publishing. ([Facebook Developers][4])

## Video format target

Default export preset:

```text
1080 × 1920
9:16 vertical
30 or 60 fps
MP4
H.264 video
AAC audio
max 60 seconds by default
winner screen for final 1 second
```

For your fight-ending rule:

```text
If a robot reaches 0 HP:
  stop battle logic
  show explosion/death animation
  show winner screen for 1 second
  end video

If no robot dies before max duration:
  winner = highest HP or damage dealt
  show result screen
  end video
```

For multi-robot fights:

```text
winner = last surviving robot or team
```

## Design principles

### 1. Seed-based determinism

Same seed + same config should always produce the same fight.

This is critical because you want to preview first, then export later. If preview and export differ, the portal becomes useless.

### 2. Data-driven everything

Robots, weapons, movement options, dice probabilities, classes, stats, and arenas should be data objects.

Do not hardcode “chainsaw robot” or “missile robot”. Define classes and weapons through configuration.

### 3. Scalable from 1v1 to N robots

Even if the first version is 1v1, every core design should assume `N robots`.

That means target selection, collisions, projectiles, UI, camera framing, and winner logic should not assume two players.

### 4. Preview ≠ export

The preview can be lower quality and faster.

The export should be deterministic, fixed-FPS, vertical, and high quality.

### 5. Procedural first, AI-generated later

Start with procedural combinations of curated pixel-art parts.

Later, use AI only to expand the asset library, not to generate unpredictable assets at render time.

### 6. Spectator-first design

This is not primarily a game for players. It is a **watchable simulation**.

Prioritize:

```text
clear action
readable projectiles
fun dice rolls
dramatic final hits
strong winner screen
camera shake
good pacing
short-form video impact
```

## MVP scope

Build the first version like this:

```text
1 arena
2 robots
3 robot classes
6–10 weapons
6 movement options
seed-based fight generation
health bars
dice roll indicators
simulation speed control
preview mode
manual export button
vertical MP4 export
winner screen
```

Do **not** start with unlimited robots, AI-generated weapons, Instagram auto-publishing, or complex asset generation. Those are Phase 2/3 features.

## Future roadmap

### Phase 1 — Fight prototype

Get the robot movement, weapon dice, HP, boundary, and winner logic working.

### Phase 2 — Portal preview

Build the internal portal with seed/config controls and embedded simulation preview.

### Phase 3 — Export engine

Add backend export using Godot Movie Maker + FFmpeg.

### Phase 4 — Content quality

Add better pixel art, effects, sound, camera shake, slow-motion final hit, intro card, and winner screen.

### Phase 5 — Procedural content engine

Add robot generator, arsenal generator, class generator, and stored asset library.

### Phase 6 — Publishing automation

Add storage, video history, metadata, captions, hashtags, and Instagram publishing.

## My final stack recommendation

```text
Godot 4               simulation, arena, physics, rendering
GDScript              core fight logic
Next.js / React       internal developer portal
Node.js / TypeScript  backend orchestration
FFmpeg                final video encoding
PostgreSQL            seeds, configs, fight history, metadata
S3 / Cloudflare R2    video and asset storage
Remotion              optional overlay/caption/title-card layer
Instagram Graph API   later publishing automation
```