(() => {
  'use strict';

  const TILE = 10;
  const COLS = 48;
  const ROWS = 32;
  const canvas = document.getElementById('game');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const ui = {
    toggle: document.getElementById('toggle'),
    reset: document.getElementById('reset'),
    speed: document.getElementById('speed'),
    speedValue: document.getElementById('speed-value'),
    mode: document.getElementById('hud-mode'),
    pad: document.getElementById('hud-pad'),
    battery: document.getElementById('hud-battery'),
    clock: document.getElementById('hud-clock'),
    explored: document.getElementById('explored'),
    exploredBar: document.getElementById('explored-bar'),
    steps: document.getElementById('steps'),
    stepsSub: document.getElementById('steps-sub'),
    position: document.getElementById('position'),
    frontier: document.getElementById('frontier'),
    detections: document.getElementById('detections'),
    sensed: document.getElementById('sensed'),
    policy: document.getElementById('policy'),
    seen: document.getElementById('seen-list'),
    log: document.getElementById('log'),
    dqnEps: document.getElementById('dqn-eps'),
    dqnEpisodes: document.getElementById('dqn-episodes'),
    dqnWinrate: document.getElementById('dqn-winrate'),
    dqnLoss: document.getElementById('dqn-loss'),
    dqnBattles: document.getElementById('dqn-battles'),
    qbars: document.getElementById('qbars'),
    chart: document.getElementById('dqn-chart')
  };

  const T = { GRASS: 0, TALL: 1, PATH: 2, WATER: 3, TREE: 4, FLOWER: 5, BUILDING: 6 };
  const WALKABLE = new Set([T.GRASS, T.TALL, T.PATH, T.FLOWER]);
  const OPAQUE = new Set([T.TREE, T.WATER, T.BUILDING]);
  const VISION_RADIUS = 6.4;
  const NEAR_SENSE = 1.6;
  const K = { UNKNOWN: 0, FREE: 1, BLOCKED: 2 };

  const MOVES = [
    { name: 'EMBER', short: 'EMBER', power: 90, type: 'fire' },
    { name: 'QUICK ATTACK', short: 'QUICK', power: 40, type: 'normal' },
    { name: 'LEAF BLADE', short: 'LEAF', power: 90, type: 'grass' },
    { name: 'THUNDERBOLT', short: 'THUNDER', power: 90, type: 'electric' }
  ];
  const TYPES = ['normal', 'fire', 'water', 'grass', 'electric'];
  const EFFECT = {
    normal: { normal: 1, fire: 1, water: 1, grass: 1, electric: 1 },
    fire: { normal: 1, fire: 0.5, water: 0.5, grass: 2, electric: 1 },
    water: { normal: 1, fire: 2, water: 0.5, grass: 0.5, electric: 1 },
    grass: { normal: 1, fire: 0.5, water: 2, grass: 0.5, electric: 1 },
    electric: { normal: 1, fire: 1, water: 2, grass: 0.5, electric: 0.5 }
  };

  let seed = 0;
  let map = [];
  let know = [];
  let totalWalkable = 1;
  let structures = [];
  let npcs = [];
  let agent = { x: 23, y: 15 };
  let path = [];
  let target = null;
  let steps = 0;
  let detections = 0;
  let seenLabels = new Set();
  let detectionBoxes = [];
  let trail = [];
  let running = true;
  let speed = 3;
  let moveFrom = { x: 23, y: 15 };
  let moveTo = { x: 23, y: 15 };
  let moveT = 1;
  let direction = { x: 0, y: -1 };
  let clockStart = performance.now();
  let stepTimes = [];
  let mode = 'EXPLORE';
  let completeSince = 0;
  let battleUntil = 0;
  let battleResult = null;
  let battery = 87;
  let acc = 0;
  let lastFrame = performance.now();
  let lastTelemetry = 0;
  let lastDQN = 0;
  let trainBudget = 0;
  let logItems = [];
  let knownCount = 0;

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function idx(x, y) { return y * COLS + x; }
  function inside(x, y) { return x >= 0 && y >= 0 && x < COLS && y < ROWS; }
  function tileAt(x, y) { return inside(x, y) ? map[y][x] : T.TREE; }
  function walkable(x, y) { return inside(x, y) && WALKABLE.has(map[y][x]); }
  function kAt(x, y) { return inside(x, y) ? know[y][x] : K.BLOCKED; }
  function knownFree(x, y) { return inside(x, y) && know[y][x] === K.FREE; }

  const structuresTemplate = [
    { x: 17, y: 7, w: 5, h: 4, type: 'poke', label: 'Pokecenter', color: '#e0606b' },
    { x: 30, y: 7, w: 4, h: 3, type: 'mart', label: 'Pokemart', color: '#5a8fd6' },
    { x: 34, y: 19, w: 5, h: 4, type: 'gym', label: 'Gym', color: '#d6a24d' },
    { x: 6, y: 8, w: 4, h: 3, type: 'house', label: 'House', color: '#8b99a8' },
    { x: 7, y: 21, w: 4, h: 3, type: 'house', label: 'House', color: '#8b99a8' },
    { x: 31, y: 24, w: 4, h: 3, type: 'house', label: 'House', color: '#8b99a8' }
  ];

  const npcTemplate = [
    { x: 20, y: 12, color: '#ffcb6b', label: 'NPC' },
    { x: 26, y: 21, color: '#ff9f7a', label: 'NPC' },
    { x: 12, y: 17, color: '#7fd1ff', label: 'NPC' },
    { x: 37, y: 12, color: '#d8a0ff', label: 'NPC' },
    { x: 5, y: 15, color: '#ffcb6b', label: 'NPC' },
    { x: 44, y: 26, color: '#7fd1ff', label: 'NPC' }
  ];

  function generate(seedValue) {
    seed = seedValue >>> 0;
    const rand = mulberry32(seed);
    map = Array.from({ length: ROWS }, () => Array(COLS).fill(T.GRASS));

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const r = rand();
        if (r < 0.055) map[y][x] = T.TREE;
        else if (r < 0.16) map[y][x] = T.TALL;
        else if (r < 0.19) map[y][x] = T.FLOWER;
      }
    }

    for (let x = 0; x < COLS; x++) {
      map[0][x] = T.TREE;
      map[ROWS - 1][x] = T.TREE;
    }
    for (let y = 0; y < ROWS; y++) {
      map[y][0] = T.TREE;
      map[y][COLS - 1] = T.TREE;
    }

    const lake = { cx: 9, cy: 27, rx: 8, ry: 5 };
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const nx = (x - lake.cx) / lake.rx;
        const ny = (y - lake.cy) / lake.ry;
        if (nx * nx + ny * ny < 1) map[y][x] = T.WATER;
      }
    }

    for (let x = 1; x < COLS - 1; x++) {
      map[14][x] = T.PATH;
      map[15][x] = T.PATH;
      map[16][x] = T.PATH;
    }
    for (let y = 1; y < ROWS - 1; y++) {
      map[y][22] = T.PATH;
      map[y][23] = T.PATH;
      map[y][24] = T.PATH;
    }

    structures = structuresTemplate.map((s) => ({ ...s, detected: false, detectAt: 0 }));
    for (const s of structures) {
      for (let y = s.y; y < s.y + s.h; y++) {
        for (let x = s.x; x < s.x + s.w; x++) {
          if (inside(x, y)) map[y][x] = T.BUILDING;
        }
      }
    }

    for (const s of structures) {
      const doorX = s.x + Math.floor(s.w / 2);
      if (s.y < 14) {
        for (let y = s.y + s.h; y <= 14; y++) if (inside(doorX, y) && map[y][doorX] !== T.BUILDING) map[y][doorX] = T.PATH;
      } else {
        for (let y = 14; y < s.y; y++) if (inside(doorX, y) && map[y][doorX] !== T.BUILDING) map[y][doorX] = T.PATH;
      }
      for (let x = doorX; x < 22; x++) if (inside(x, 15) && map[15][x] !== T.BUILDING) map[15][x] = T.PATH;
    }

    npcs = npcTemplate.map((n) => ({ ...n, detected: false }));
    for (const n of npcs) {
      if (!walkable(n.x, n.y)) {
        const found = nearestWalkable(n.x, n.y);
        if (found) { n.x = found.x; n.y = found.y; }
      }
    }

    totalWalkable = 0;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (WALKABLE.has(map[y][x])) totalWalkable++;
    totalWalkable = Math.max(1, totalWalkable);
  }

  function nearestWalkable(sx, sy) {
    for (let r = 1; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = sx + dx;
          const y = sy + dy;
          if (walkable(x, y)) return { x, y };
        }
      }
    }
    return null;
  }

  function lineOfSight(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    while (x !== x1 || y !== y1) {
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) return true;
      if (OPAQUE.has(tileAt(x, y))) return false;
    }
    return true;
  }

  function perceive() {
    const seenThisFrame = [];
    const r = Math.ceil(VISION_RADIUS);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = agent.x + dx;
        const y = agent.y + dy;
        if (!inside(x, y)) continue;
        const distance = Math.hypot(dx, dy);
        if (distance > VISION_RADIUS) continue;
        if (distance > NEAR_SENSE && !lineOfSight(agent.x, agent.y, x, y)) {
          if (know[y][x] === K.UNKNOWN) {
            const blocker = traceBlocker(agent.x, agent.y, x, y);
            if (blocker) markTile(blocker.x, blocker.y, seenThisFrame);
          }
          continue;
        }
        markTile(x, y, seenThisFrame);
      }
    }
    detectObjects(seenThisFrame);
    return seenThisFrame;
  }

  function traceBlocker(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    while (x !== x1 || y !== y1) {
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) return null;
      if (OPAQUE.has(tileAt(x, y))) return { x, y };
    }
    return null;
  }

  function markTile(x, y, seenThisFrame) {
    const was = know[y][x];
    const next = walkable(x, y) ? K.FREE : K.BLOCKED;
    if (was === K.UNKNOWN) knownCount++;
    know[y][x] = next;
    if (was === K.UNKNOWN) seenThisFrame.push({ x, y });
  }

  function detectObjects(seenThisFrame) {
    if (!seenThisFrame.length) return;
    const seenIdx = new Set(seenThisFrame.map((c) => idx(c.x, c.y)));
    for (const s of structures) {
      if (s.detected) continue;
      let visible = 0;
      for (let y = s.y; y < s.y + s.h; y++) {
        for (let x = s.x; x < s.x + s.w; x++) {
          if (seenIdx.has(idx(x, y))) visible++;
        }
      }
      if (!visible) continue;
      const center = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
      const d = Math.hypot(center.x - agent.x, center.y - agent.y);
      const fraction = visible / (s.w * s.h);
      const conf = Math.max(0.42, Math.min(0.98, 0.55 + fraction * 0.35 - d * 0.02 + Math.random() * 0.04));
      s.detected = true;
      s.detectAt = performance.now();
      detections++;
      seenLabels.add(s.label);
      detectionBoxes.push({ x: s.x, y: s.y, w: s.w, h: s.h, label: s.label, conf, born: performance.now() });
      if (detectionBoxes.length > 5) detectionBoxes.shift();
      pushLog(`detected ${s.label.toLowerCase()} · ${visible}px · conf ${conf.toFixed(2)}`);
    }
    for (const n of npcs) {
      if (n.detected) continue;
      if (!seenIdx.has(idx(n.x, n.y))) continue;
      const d = Math.hypot(n.x - agent.x, n.y - agent.y);
      n.detected = true;
      detections++;
      seenLabels.add(n.label);
      detectionBoxes.push({
        x: n.x - 1, y: n.y - 1, w: 2, h: 2, label: n.label,
        conf: Math.max(0.5, Math.min(0.96, 0.9 - d * 0.05 + Math.random() * 0.04)),
        born: performance.now()
      });
      if (detectionBoxes.length > 5) detectionBoxes.shift();
      pushLog(`detected npc at x:${n.x} y:${n.y} · conf ${detectionBoxes[detectionBoxes.length - 1].conf.toFixed(2)}`);
    }
  }

  function bfsKnown(start) {
    const prev = new Int32Array(COLS * ROWS).fill(-1);
    const distMap = new Int32Array(COLS * ROWS).fill(-1);
    const queue = [idx(start.x, start.y)];
    distMap[queue[0]] = 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      const cx = cur % COLS;
      const cy = (cur / COLS) | 0;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!knownFree(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (distMap[ni] !== -1) continue;
        distMap[ni] = distMap[cur] + 1;
        prev[ni] = cur;
        queue.push(ni);
      }
    }
    return { prev, distMap };
  }

  function chooseFrontier() {
    const { prev, distMap } = bfsKnown(agent);
    const dirs8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let best = -1;
    let bestScore = -Infinity;
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        const i = idx(x, y);
        if (!knownFree(x, y) || distMap[i] < 0) continue;
        let unknownN = 0;
        let blockedN = 0;
        for (const [dx, dy] of dirs8) {
          const k = kAt(x + dx, y + dy);
          if (k === K.UNKNOWN) unknownN++;
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (kAt(x + dx, y + dy) === K.BLOCKED) blockedN++;
        }
        if (!unknownN) continue;
        let interest = 0;
        for (const s of structures) {
          if (s.detected) continue;
          const d = Math.abs(x - (s.x + s.w / 2)) + Math.abs(y - (s.y + s.h / 2));
          if (d < 11) interest = Math.max(interest, (11 - d) * 0.55);
        }
        const score = unknownN * 5.4 - distMap[i] * 0.42 - blockedN * 0.7 + interest + Math.random() * 0.9;
        if (score > bestScore) { bestScore = score; best = i; }
      }
    }
    if (best < 0) return null;
    const back = [];
    let cursor = best;
    while (cursor !== -1) {
      back.push({ x: cursor % COLS, y: (cursor / COLS) | 0 });
      cursor = prev[cursor];
    }
    back.reverse();
    back.shift();
    return back;
  }

  function makeEnv() {
    return {
      pHp: 100,
      maxPHp: 100,
      eHp: 70 + Math.random() * 50,
      maxEHp: 120,
      eType: TYPES[Math.floor(Math.random() * TYPES.length)],
      pp: [10, 10, 10, 10],
      turn: 0,
      done: false
    };
  }

  function battleState(env) {
    const s = new Float32Array(12);
    s[0] = env.pHp / 100;
    s[1] = env.eHp / 120;
    for (let i = 0; i < 4; i++) s[2 + i] = env.pp[i] / 10;
    const ti = TYPES.indexOf(env.eType);
    for (let i = 0; i < 5; i++) s[6 + i] = i === ti ? 1 : 0;
    s[11] = Math.min(1, env.turn / 20);
    return s;
  }

  function envStep(env, action) {
    if (env.done) return { reward: 0, done: true, dealt: 0, taken: 0 };
    let dealt = 0;
    let taken = 0;
    if (env.pp[action] > 0) {
      env.pp[action] -= 1;
      const move = MOVES[action];
      const eff = EFFECT[move.type][env.eType];
      dealt = Math.round(move.power * eff * (0.8 + Math.random() * 0.4) * 0.3);
      env.eHp = Math.max(0, env.eHp - dealt);
    }
    if (env.eHp > 0) {
      const stab = 0.75 + Math.random() * 0.5;
      taken = Math.round((42 + Math.random() * 34) * stab * 0.3);
      env.pHp = Math.max(0, env.pHp - taken);
    }
    env.turn += 1;
    const noPp = env.pp.every((p) => p <= 0);
    env.done = env.eHp <= 0 || env.pHp <= 0 || env.turn >= 30 || noPp;
    let reward = dealt - taken;
    reward = reward * 0.05;
    if (env.eHp <= 0) reward += 2.4;
    if (env.pHp <= 0) reward -= 2.4;
    return { reward, done: env.done, dealt, taken };
  }

  const NET = {
    IN: 12, HID: 24, OUT: 4,
    W1: null, b1: null, W2: null, b2: null,
    tW1: null, tb1: null, tW2: null, tb2: null,
    dW1: null, db1: null, dW2: null, db2: null
  };
  const DQN = {
    lr: 0.008,
    gamma: 0.92,
    batch: 32,
    cap: 4000,
    epsilon: 1,
    episodes: 0,
    steps: 0,
    loss: 0,
    replay: [],
    replayPos: 0,
    replayLen: 0,
    lastQ: new Float32Array(4),
    wins: [],
    curve: [],
    trainEnv: null,
    simBattles: 0,
    simWins: 0
  };
  const H = new Float32Array(NET.HID);
  const HN = new Float32Array(NET.HID);
  const Q = new Float32Array(NET.OUT);
  const QN = new Float32Array(NET.OUT);
  const DQ = new Float32Array(NET.OUT);
  const DH = new Float32Array(NET.HID);

  function netRand() {
    NET._s = (NET._s || 987654321) >>> 0;
    NET._s = (Math.imul(NET._s, 1664525) + 1013904223) >>> 0;
    return NET._s / 4294967296;
  }

  function netNormal() {
    let u = 0;
    let v = 0;
    while (u === 0) u = netRand();
    while (v === 0) v = netRand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function netInit() {
    const { IN, HID, OUT } = NET;
    NET.W1 = new Float32Array(HID * IN);
    NET.b1 = new Float32Array(HID);
    NET.W2 = new Float32Array(OUT * HID);
    NET.b2 = new Float32Array(OUT);
    NET.tW1 = new Float32Array(HID * IN);
    NET.tb1 = new Float32Array(HID);
    NET.tW2 = new Float32Array(OUT * HID);
    NET.tb2 = new Float32Array(OUT);
    NET.dW1 = new Float32Array(HID * IN);
    NET.db1 = new Float32Array(HID);
    NET.dW2 = new Float32Array(OUT * HID);
    NET.db2 = new Float32Array(OUT);
    for (let i = 0; i < NET.W1.length; i++) NET.W1[i] = netNormal() * Math.sqrt(2 / IN);
    for (let i = 0; i < NET.W2.length; i++) NET.W2[i] = netNormal() * Math.sqrt(2 / HID);
    copyTarget();
  }

  function copyTarget() {
    NET.tW1.set(NET.W1);
    NET.tb1.set(NET.b1);
    NET.tW2.set(NET.W2);
    NET.tb2.set(NET.b2);
  }

  function forwardInto(s, target, hOut, qOut) {
    const W1 = target ? NET.tW1 : NET.W1;
    const b1 = target ? NET.tb1 : NET.b1;
    const W2 = target ? NET.tW2 : NET.W2;
    const b2 = target ? NET.tb2 : NET.b2;
    const { IN, HID, OUT } = NET;
    for (let i = 0; i < HID; i++) {
      let sum = b1[i];
      const row = i * IN;
      for (let j = 0; j < IN; j++) sum += W1[row + j] * s[j];
      hOut[i] = sum > 0 ? sum : 0;
    }
    for (let k = 0; k < OUT; k++) {
      let sum = b2[k];
      const row = k * HID;
      for (let i = 0; i < HID; i++) sum += W2[row + i] * hOut[i];
      qOut[k] = sum;
    }
  }

  function dqnAct(s, explore) {
    forwardInto(s, false, H, Q);
    DQN.lastQ.set(Q);
    if (explore && Math.random() < DQN.epsilon) return Math.floor(Math.random() * 4);
    let best = 0;
    for (let i = 1; i < 4; i++) if (Q[i] > Q[best]) best = i;
    return best;
  }

  function pushReplay(s, a, r, s2, done) {
    const item = { s: Float32Array.from(s), a, r, s2: Float32Array.from(s2), done };
    if (DQN.replay.length < DQN.cap) {
      DQN.replay.push(item);
      DQN.replayLen = DQN.replay.length;
    } else {
      DQN.replay[DQN.replayPos] = item;
      DQN.replayPos = (DQN.replayPos + 1) % DQN.cap;
      DQN.replayLen = DQN.cap;
    }
  }

  function trainBatch() {
    if (DQN.replayLen < 96) return;
    const { IN, HID, OUT } = NET;
    NET.dW1.fill(0);
    NET.db1.fill(0);
    NET.dW2.fill(0);
    NET.db2.fill(0);
    let total = 0;
    for (let b = 0; b < DQN.batch; b++) {
      const item = DQN.replay[Math.floor(Math.random() * DQN.replayLen)];
      forwardInto(item.s, false, H, Q);
      let maxNext = -Infinity;
      if (!item.done) {
        forwardInto(item.s2, true, HN, QN);
        for (let k = 0; k < OUT; k++) if (QN[k] > maxNext) maxNext = QN[k];
      }
      const targetQ = item.r + (item.done ? 0 : DQN.gamma * maxNext);
      const err = Q[item.a] - targetQ;
      total += err * err;
      DQ[0] = 0; DQ[1] = 0; DQ[2] = 0; DQ[3] = 0;
      DQ[item.a] = err;
      for (let k = 0; k < OUT; k++) {
        NET.db2[k] += DQ[k];
        const row = k * HID;
        for (let i = 0; i < HID; i++) NET.dW2[row + i] += DQ[k] * H[i];
      }
      for (let i = 0; i < HID; i++) {
        let g = 0;
        for (let k = 0; k < OUT; k++) g += NET.W2[k * HID + i] * DQ[k];
        DH[i] = H[i] > 0 ? g : 0;
        NET.db1[i] += DH[i];
        const row = i * IN;
        for (let j = 0; j < IN; j++) NET.dW1[row + j] += DH[i] * item.s[j];
      }
    }
    const scale = DQN.lr / DQN.batch;
    for (let i = 0; i < NET.W1.length; i++) NET.W1[i] -= scale * NET.dW1[i];
    for (let i = 0; i < NET.b1.length; i++) NET.b1[i] -= scale * NET.db1[i];
    for (let i = 0; i < NET.W2.length; i++) NET.W2[i] -= scale * NET.dW2[i];
    for (let i = 0; i < NET.b2.length; i++) NET.b2[i] -= scale * NET.db2[i];
    DQN.loss = DQN.loss * 0.96 + (total / DQN.batch) * 0.04;
  }

  function trainStep() {
    if (!DQN.trainEnv || DQN.trainEnv.done) DQN.trainEnv = makeEnv();
    const env = DQN.trainEnv;
    const s = battleState(env);
    const a = dqnAct(s, true);
    const res = envStep(env, a);
    const s2 = battleState(env);
    pushReplay(s, a, res.reward, s2, res.done);
    trainBatch();
    DQN.steps++;
    if (res.done) {
      DQN.episodes++;
      DQN.wins.push(env.eHp <= 0 ? 1 : 0);
      if (DQN.wins.length > 100) DQN.wins.shift();
      DQN.epsilon = Math.max(0.05, DQN.epsilon * 0.991);
      if (DQN.episodes % 20 === 0) copyTarget();
      let w = 0;
      for (const v of DQN.wins) w += v;
      DQN.curve.push(DQN.wins.length ? w / DQN.wins.length : 0);
      if (DQN.curve.length > 140) DQN.curve.shift();
      DQN.trainEnv = makeEnv();
    }
  }

  function runBattle() {
    const env = makeEnv();
    const choices = [];
    while (!env.done) {
      const a = dqnAct(battleState(env), false);
      choices.push(MOVES[a].name);
      envStep(env, a);
    }
    const won = env.eHp <= 0;
    DQN.simBattles++;
    if (won) DQN.simWins++;
    battleResult = {
      won,
      move: choices[0] || MOVES[0].name,
      turns: choices.length,
      q: Math.max(...Array.from(DQN.lastQ))
    };
    return battleResult;
  }

  function tick() {
    const now = performance.now();
    if (completeSince) {
      if (now - completeSince > 6200) resetMap();
      return;
    }
    if (mode === 'BATTLE' && now < battleUntil) return;
    if (mode === 'BATTLE' && now >= battleUntil) {
      mode = 'EXPLORE';
      if (battleResult) pushLog(`battle ${battleResult.won ? 'won' : 'lost'} · dqn ${battleResult.move.toLowerCase()}`);
    }
    if (path.length === 0) {
      const next = chooseFrontier();
      if (!next || next.length === 0) {
        completeSince = now;
        mode = 'COMPLETE';
        ui.mode.textContent = 'MAP COMPLETE';
        pushLog(`map complete · ${steps} steps · ${knownCount} tiles sensed`);
        updateTelemetry(now);
        return;
      }
      path = next;
      target = path[path.length - 1];
      pushLog(`frontier x:${target.x} y:${target.y} · bfs ${path.length}`);
    }

    const nextCell = path[0];
    if (!nextCell || !knownFree(nextCell.x, nextCell.y)) {
      path = [];
      target = null;
      perceive();
      return;
    }
    path.shift();
    if (!walkable(nextCell.x, nextCell.y)) {
      know[nextCell.y][nextCell.x] = K.BLOCKED;
      path = [];
      target = null;
      pushLog('collision · replanning from occupancy grid');
      return;
    }

    moveFrom = { x: agent.x, y: agent.y };
    moveT = 0;
    direction = { x: Math.sign(nextCell.x - agent.x), y: Math.sign(nextCell.y - agent.y) };
    agent.x = nextCell.x;
    agent.y = nextCell.y;
    moveTo = { x: agent.x, y: agent.y };
    steps++;
    stepTimes.push(now);
    if (stepTimes.length > 12) stepTimes.shift();
    battery = Math.max(11, battery - 0.006);
    perceive();
    trail.push({ x: agent.x, y: agent.y, born: now });
    if (trail.length > 26) trail.shift();

    if (steps % 42 === 0 && mode !== 'BATTLE') {
      runBattle();
      mode = 'BATTLE';
      battleUntil = now + 2300;
      if (battleResult) {
        pushLog(`battle · dqn selects ${battleResult.move.toLowerCase()} · ${battleResult.won ? 'win' : 'loss'}`);
      }
    }

    if (Math.random() < 0.14) {
      const phrases = [
        'odometry drift corrected',
        'line-of-sight map merge · no duplicates',
        'occupancy grid updated from frame',
        'retina-net inference · 6 classes',
        'new frontier scored by unknown neighbours'
      ];
      pushLog(phrases[Math.floor(Math.random() * phrases.length)]);
    }
    updateTelemetry(now);
  }

  function pushLog(text) {
    const t = new Date();
    const stamp = [t.getHours(), t.getMinutes(), t.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    logItems.unshift(`${stamp} ${text}`);
    logItems = logItems.slice(0, 7);
    ui.log.innerHTML = '';
    for (const item of logItems) {
      const li = document.createElement('li');
      li.textContent = item;
      ui.log.appendChild(li);
    }
  }

  function directionLabel() {
    if (direction.y < 0) return 'UP';
    if (direction.y > 0) return 'DOWN';
    if (direction.x < 0) return 'LEFT';
    if (direction.x > 0) return 'RIGHT';
    return 'IDLE';
  }

  function exploredPercent() {
    let n = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (know[y][x] === K.FREE && WALKABLE.has(map[y][x])) n++;
      }
    }
    return Math.min(100, Math.round((n / totalWalkable) * 100));
  }

  function updateTelemetry(now = performance.now()) {
    if (now - lastTelemetry < 180) return;
    lastTelemetry = now;
    const pct = exploredPercent();
    ui.explored.textContent = `${pct}%`;
    ui.exploredBar.style.width = `${pct}%`;
    ui.steps.textContent = String(steps);
    const recent = stepTimes.filter((t) => now - t < 1500);
    ui.stepsSub.textContent = `${(recent.length / 1.5).toFixed(1)} tiles / sec`;
    ui.position.textContent = `x:${String(agent.x).padStart(2, '0')} y:${String(agent.y).padStart(2, '0')}`;
    ui.frontier.textContent = target ? `x:${target.x} y:${target.y}` : 'searching…';
    ui.detections.textContent = String(detections);
    if (ui.sensed) ui.sensed.textContent = `${knownCount} tiles`;
    ui.pad.textContent = `${directionLabel()} · STEP ${String(steps).padStart(4, '0')}`;
    ui.battery.textContent = `${Math.round(battery)}%`;
    const total = Math.floor((now - clockStart) / 1000);
    const hh = String(Math.floor(total / 3600)).padStart(2, '0');
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    ui.clock.textContent = `${hh}:${mm}:${ss}`;
    ui.mode.textContent = mode;
    ui.mode.style.color = mode === 'BATTLE' ? 'var(--amber)' : mode === 'COMPLETE' ? 'var(--blue)' : 'var(--mint)';
    ui.mode.style.borderColor = mode === 'BATTLE' ? 'rgba(255,203,107,.4)' : 'rgba(95,242,182,.3)';

    if (seenLabels.size === 0) {
      ui.seen.innerHTML = '<li class="chip empty">no detections yet</li>';
    } else {
      ui.seen.innerHTML = '';
      for (const label of seenLabels) {
        const li = document.createElement('li');
        li.className = 'chip';
        li.textContent = label;
        ui.seen.appendChild(li);
      }
    }
  }

  function qbarEls() {
    if (!ui.qbars || ui.qbars.childElementCount) return;
    for (let i = 0; i < 4; i++) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = MOVES[i].short;
      const track = document.createElement('i');
      const fill = document.createElement('b');
      track.appendChild(fill);
      const val = document.createElement('em');
      li.appendChild(name);
      li.appendChild(track);
      li.appendChild(val);
      ui.qbars.appendChild(li);
    }
  }

  function updateDQN(now) {
    qbarEls();
    if (now - lastDQN < 260) return;
    lastDQN = now;
    if (ui.dqnEpisodes) ui.dqnEpisodes.textContent = DQN.episodes.toLocaleString();
    const wrRaw = DQN.wins.length ? Math.round((DQN.wins.reduce((a, b) => a + b, 0) / DQN.wins.length) * 100) : 0;
    if (ui.dqnWinrate) ui.dqnWinrate.textContent = DQN.wins.length ? `${wrRaw}%` : '—';
    if (ui.policy) ui.policy.textContent = DQN.wins.length ? `ε ${DQN.epsilon.toFixed(2)} · win ${wrRaw}%` : `ε ${DQN.epsilon.toFixed(2)}`;
    if (ui.dqnLoss) ui.dqnLoss.textContent = DQN.steps > 0 ? DQN.loss.toFixed(3) : '—';
    if (ui.dqnBattles) ui.dqnBattles.textContent = String(DQN.simBattles);
    if (ui.dqnEps) ui.dqnEps.textContent = `ε ${DQN.epsilon.toFixed(2)}`;
    if (ui.qbars) {
      const maxAbs = Math.max(0.2, ...Array.from(DQN.lastQ).map(Math.abs));
      const rows = ui.qbars.children;
      for (let i = 0; i < rows.length; i++) {
        const q = DQN.lastQ[i];
        const fill = rows[i].querySelector('b');
        const val = rows[i].querySelector('em');
        fill.style.width = `${Math.min(100, (Math.abs(q) / maxAbs) * 100)}%`;
        fill.style.background = q >= 0 ? 'var(--mint)' : 'var(--rose)';
        val.textContent = q.toFixed(2);
      }
    }
    drawChart();
  }

  function drawChart() {
    const c = ui.chart;
    if (!c) return;
    const g = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(174,208,222,0.14)';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(0, (h * i) / 4 + 0.5);
      g.lineTo(w, (h * i) / 4 + 0.5);
      g.stroke();
    }
    const pts = DQN.curve;
    if (pts.length < 2) return;
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = (i / (pts.length - 1)) * (w - 2) + 1;
      const y = h - 2 - pts[i] * (h - 4);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = '#5ff2b6';
    g.lineWidth = 1.4;
    g.stroke();
    g.lineTo(w - 1, h);
    g.lineTo(1, h);
    g.closePath();
    g.fillStyle = 'rgba(95,242,182,0.12)';
    g.fill();
  }

  function hash(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function drawTerrain(now) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const px = x * TILE;
        const py = y * TILE;
        if (know[y][x] === K.UNKNOWN) {
          ctx.fillStyle = '#081019';
          ctx.fillRect(px, py, TILE, TILE);
          if (hash(x, y) > 0.72) {
            ctx.fillStyle = 'rgba(127,209,255,0.07)';
            ctx.fillRect(px + 4, py + 4, 1, 1);
          }
          continue;
        }
        const tile = map[y][x];
        const v = hash(x, y);
        if (tile === T.WATER) {
          ctx.fillStyle = '#173f60';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = 'rgba(127,209,255,0.22)';
          const off = Math.sin(now / 900 + (x + y) * 0.6) * 2;
          ctx.fillRect(px + 2 + off, py + 4, 5, 1);
          ctx.fillRect(px + 4 - off, py + 7, 4, 1);
        } else if (tile === T.TREE) {
          ctx.fillStyle = v > 0.5 ? '#235c41' : '#276449';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = '#143b2a';
          ctx.fillRect(px + 4, py + 6, 2, 3);
          ctx.fillStyle = v > 0.5 ? '#1c5238' : '#1a4b33';
          ctx.fillRect(px + 1, py + 1, 8, 6);
          ctx.fillStyle = 'rgba(95,242,182,0.12)';
          ctx.fillRect(px + 2, py + 2, 3, 2);
        } else if (tile === T.TALL) {
          ctx.fillStyle = '#225c42';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.strokeStyle = '#3f8a63';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px + 2, py + 8);
          ctx.lineTo(px + 3, py + 4);
          ctx.moveTo(px + 6, py + 8);
          ctx.lineTo(px + 7, py + 5);
          ctx.stroke();
          ctx.fillStyle = '#2f7a58';
          ctx.fillRect(px + 4, py + 5, 1, 3);
        } else if (tile === T.PATH) {
          ctx.fillStyle = v > 0.5 ? '#bfae83' : '#c6b58a';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = 'rgba(90,76,46,0.24)';
          ctx.fillRect(px + 2, py + 3, 1, 1);
          ctx.fillRect(px + 7, py + 6, 1, 1);
          ctx.fillStyle = 'rgba(255,255,255,0.14)';
          ctx.fillRect(px + 5, py + 2, 1, 1);
        } else if (tile === T.FLOWER) {
          ctx.fillStyle = '#2f6b4e';
          ctx.fillRect(px, py, TILE, TILE);
          const colors = ['#ff8fa3', '#ffd479', '#8fd5ff', '#f0a6ff'];
          for (let i = 0; i < 3; i++) {
            ctx.fillStyle = colors[(x + y + i) % colors.length];
            ctx.fillRect(px + 2 + i * 2.4, py + 3 + ((i + x) % 3) * 2, 1, 1);
          }
        } else {
          ctx.fillStyle = v > 0.62 ? '#2e6c4f' : v > 0.3 ? '#316f52' : '#2b674b';
          ctx.fillRect(px, py, TILE, TILE);
          if (v > 0.9) {
            ctx.fillStyle = 'rgba(95,242,182,0.22)';
            ctx.fillRect(px + 3, py + 5, 1, 1);
            ctx.fillRect(px + 6, py + 3, 1, 1);
          }
        }
        if (know[y][x] === K.BLOCKED) {
          ctx.fillStyle = 'rgba(4,8,12,0.5)';
          ctx.fillRect(px, py, TILE, TILE);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.09)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px + 0.25, py + 0.25, TILE - 0.5, TILE - 0.5);
      }
    }
  }

  function drawBuilding(s) {
    const px = s.x * TILE;
    const py = s.y * TILE;
    const w = s.w * TILE;
    const h = s.h * TILE;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(px + 2, py + 3, w, h);
    ctx.fillStyle = '#22303d';
    ctx.fillRect(px, py + Math.floor(h * 0.34), w, Math.ceil(h * 0.66));
    ctx.fillStyle = s.color;
    ctx.fillRect(px, py, w, Math.ceil(h * 0.4));
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.fillRect(px, py + Math.floor(h * 0.34), w, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(px + 2, py + 2, w - 4, 1);
    ctx.fillStyle = '#12202b';
    const doorW = 8;
    ctx.fillRect(px + Math.floor((w - doorW) / 2), py + h - 9, doorW, 9);
    ctx.fillStyle = '#ffcb6b';
    ctx.fillRect(px + Math.floor((w - doorW) / 2) + 6, py + h - 6, 1, 1);
    ctx.fillStyle = 'rgba(127,209,255,0.85)';
    ctx.fillRect(px + 3, py + Math.floor(h * 0.5), 4, 3);
    ctx.fillRect(px + w - 7, py + Math.floor(h * 0.5), 4, 3);
    if (s.type === 'poke') {
      ctx.fillStyle = '#f3f7f5';
      ctx.fillRect(px + Math.floor(w / 2) - 1, py + 4, 3, 3);
    } else if (s.type === 'gym') {
      ctx.fillStyle = '#ffcb6b';
      ctx.fillRect(px + Math.floor(w / 2) - 2, py + 3, 4, 2);
    }
  }

  function drawNpc(n) {
    const px = n.x * TILE + TILE / 2;
    const py = n.y * TILE + TILE / 2;
    ctx.fillStyle = n.color;
    ctx.fillRect(px - 2, py - 4, 4, 3);
    ctx.fillRect(px - 2, py - 1, 4, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(px - 2, py + 4, 1, 1);
    ctx.fillRect(px + 1, py + 4, 1, 1);
  }

  function drawDetections(now) {
    for (const box of detectionBoxes) {
      const age = now - box.born;
      const alpha = Math.max(0.25, 1 - age / 8000);
      const px = box.x * TILE;
      const py = box.y * TILE;
      const w = box.w * TILE;
      const h = box.h * TILE;
      const pulse = 0.55 + Math.sin(now / 320 + box.x) * 0.18;
      ctx.strokeStyle = `rgba(95,242,182,${Math.min(1, alpha + 0.15) * pulse})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
      const label = `${box.label.toUpperCase()} ${box.conf.toFixed(2)}`;
      ctx.font = '6px ui-monospace, monospace';
      const tw = ctx.measureText(label).width;
      const ly = Math.max(7, py - 9);
      ctx.fillStyle = `rgba(6,18,13,${0.86 * alpha + 0.1})`;
      ctx.fillRect(px, ly, tw + 5, 8);
      ctx.fillStyle = `rgba(95,242,182,${0.65 + 0.35 * alpha})`;
      ctx.fillRect(px, ly, 1, 8);
      ctx.fillStyle = `rgba(232,242,239,${0.6 + 0.4 * alpha})`;
      ctx.fillText(label, px + 3, ly + 6);
    }
  }

  function drawAgent(now) {
    for (let i = 0; i < trail.length; i++) {
      const t = trail[i];
      const fade = (i + 1) / trail.length;
      ctx.fillStyle = `rgba(95,242,182,${0.04 + fade * 0.1})`;
      ctx.fillRect(t.x * TILE + 4, t.y * TILE + 4, 2, 2);
    }
    let x = agent.x;
    let y = agent.y;
    if (moveT < 1) {
      const e = 1 - Math.pow(1 - Math.min(1, moveT), 3);
      x = moveFrom.x + (moveTo.x - moveFrom.x) * e;
      y = moveFrom.y + (moveTo.y - moveFrom.y) * e;
    }
    const px = x * TILE + TILE / 2;
    const py = y * TILE + TILE / 2;
    const glow = ctx.createRadialGradient(px, py, 0, px, py, 16);
    glow.addColorStop(0, 'rgba(95,242,182,0.35)');
    glow.addColorStop(1, 'rgba(95,242,182,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(px - 16, py - 16, 32, 32);
    ctx.fillStyle = '#0a1b14';
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5ff2b6';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#5ff2b6';
    ctx.beginPath();
    ctx.arc(px, py, 1.7, 0, Math.PI * 2);
    ctx.fill();
    const ang = Math.atan2(direction.y, direction.x);
    ctx.fillStyle = 'rgba(95,242,182,0.9)';
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(ang) * 8, py + Math.sin(ang) * 8);
    ctx.lineTo(px + Math.cos(ang + 2.4) * 4.5, py + Math.sin(ang + 2.4) * 4.5);
    ctx.lineTo(px + Math.cos(ang - 2.4) * 4.5, py + Math.sin(ang - 2.4) * 4.5);
    ctx.closePath();
    ctx.fill();
  }

  function draw(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#081019';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawTerrain(now);
    for (const s of structures) {
      if (s.detected) drawBuilding(s);
    }
    for (const n of npcs) {
      if (n.detected && know[n.y] && know[n.y][n.x] !== K.UNKNOWN) drawNpc(n);
    }
    drawDetections(now);
    drawAgent(now);

    if (mode === 'BATTLE') {
      ctx.fillStyle = 'rgba(255,203,107,0.07)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(5,10,16,0.86)';
      ctx.fillRect(12, 12, 252, battleResult ? 62 : 40);
      ctx.strokeStyle = 'rgba(255,203,107,0.42)';
      ctx.strokeRect(12.5, 12.5, 251, battleResult ? 61 : 39);
      ctx.fillStyle = 'rgba(255,203,107,0.95)';
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.fillText('BATTLE  ·  DQN TURN', 22, 32);
      if (battleResult) {
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillStyle = 'rgba(232,242,239,0.88)';
        ctx.fillText(`${battleResult.move} · q ${battleResult.q.toFixed(2)} · ${battleResult.turns} turns`, 22, 47);
        ctx.fillStyle = battleResult.won ? '#5ff2b6' : '#ff7a90';
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.fillText(battleResult.won ? 'WIN' : 'LOSS', 22, 64);
      }
    }

    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < canvas.height; y += 3) ctx.fillRect(0, y, canvas.width, 1);
    const vig = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.3, canvas.width / 2, canvas.height / 2, canvas.height * 0.82);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function frame(now) {
    const dt = Math.min(120, now - lastFrame);
    lastFrame = now;
    const interval = Math.max(38, 150 / speed);
    if (running) {
      trainBudget = Math.min(8, trainBudget + dt * 0.12);
      while (trainBudget >= 1) {
        trainBudget -= 1;
        trainStep();
      }
    }
    if (running) {
      acc += dt;
      while (acc >= interval) {
        acc -= interval;
        tick();
      }
      if (moveT < 1) moveT = Math.min(1, moveT + dt / interval);
    }
    draw(now);
    if (now - lastTelemetry > 400) updateTelemetry(now);
    updateDQN(now);
    requestAnimationFrame(frame);
  }

  function resetMap(newSeed = true) {
    const nextSeed = newSeed ? (Math.random() * 0xffffffff) >>> 0 : seed;
    generate(nextSeed);
    know = Array.from({ length: ROWS }, () => new Uint8Array(COLS));
    knownCount = 0;
    agent = { x: 23, y: 15 };
    if (!walkable(agent.x, agent.y)) {
      const found = nearestWalkable(agent.x, agent.y) || { x: 23, y: 15 };
      agent = found;
    }
    moveFrom = { ...agent };
    moveTo = { ...agent };
    moveT = 1;
    direction = { x: 0, y: -1 };
    path = [];
    target = null;
    steps = 0;
    detections = 0;
    seenLabels = new Set();
    detectionBoxes = [];
    trail = [];
    stepTimes = [];
    clockStart = performance.now();
    completeSince = 0;
    mode = 'EXPLORE';
    battleUntil = 0;
    battleResult = null;
    battery = 87;
    acc = 0;
    logItems = [];
    ui.log.innerHTML = '';
    pushLog(`boot · route map seed ${nextSeed >>> 0}`);
    pushLog(`retina-net loaded · 6 classes · online dqn ready`);
    perceive();
    updateTelemetry(performance.now());
    updateDQN(performance.now());
    draw(performance.now());
  }

  ui.toggle.addEventListener('click', () => {
    running = !running;
    ui.toggle.textContent = running ? 'Pause' : 'Resume';
    pushLog(running ? 'agent resumed' : 'agent paused');
  });
  ui.reset.addEventListener('click', () => resetMap(true));
  ui.speed.addEventListener('input', () => {
    speed = Number(ui.speed.value) || 3;
    ui.speedValue.textContent = `${speed}×`;
  });

  netInit();
  resetMap(true);
  draw(performance.now());
  document.body.dataset.ready = 'true';
  requestAnimationFrame(frame);
})();
