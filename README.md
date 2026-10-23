# pokeai

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Remixed using [OMGithub.com](https://omgithub.com).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://omgithub.com/Torchwood4201/pokeai)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/Torchwood4201/pokeai)

- 🎮 [Open the project](https://omgithub.com/Torchwood4201/pokeai).
- ✨ [Remix this project](https://omgithub.com/?remix=Torchwood4201%2Fpokeai).
- 💻 [Explore the source](https://github.com/Torchwood4201/pokeai).
- 🛠️ [Check build runs](https://github.com/Torchwood4201/pokeai/actions).
- 🐛 [Report an issue](https://github.com/Torchwood4201/pokeai/issues).
- 👤 [Explore the creator's projects](https://omgithub.com/Torchwood4201).
- 🌍 [Create with OMGithub](https://omgithub.com).
- 🧬 [Explore the remix source](https://github.com/Torchwood4201/pokeai).
<!-- omgithub:readme:end -->

## AI implementation

The live lab is a working browser-side reimplementation of the three modules
from [poke-AI/poke.AI](https://github.com/poke-AI/poke.AI):

- **Perception** — line-of-sight raycasting against the tile map fills a
  persistent occupancy grid (`unknown` / `free` / `blocked`). Buildings and NPCs
  are only reported once their tiles are actually visible.
- **Exploration** — frontier tiles (known free tiles next to unknown space) are
  scored by unknown neighbours, blocker risk, distance and detection interest.
  A BFS then returns the path; collisions and stale paths trigger a replan.
- **Battles** — a 12 → 24 → 4 DQN with experience replay, a target network and
  epsilon decay trains online in the page. The reward is damage dealt minus
  damage taken, plus a terminal win/loss bonus; the live Q-values and winrate
  are shown under the game screen.

No copyrighted ROM data is bundled. The demo runs on a procedural Hoenn-style
map so the full loop is reproducible in a browser; the original project drove a
real Pokémon Emerald ROM through VBA-Rerecording.

## Run

```bash
PORT=3002 ./start.sh
```

Then open http://localhost:3002. `capture.sh` writes desktop and mobile proof
screenshots when `CAPTURE_URL` and `CAPTURE_DIR` are set.
