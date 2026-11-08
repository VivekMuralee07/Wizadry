// Wardens of Thornhold — shared data + movement rules (runs in Node and in the browser)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WARDENS = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const OBS = {
    lock:   { icon: '🔒', name: 'Locked door' },
    ward:   { icon: '✴',  name: 'Ward spell' },
    water:  { icon: '≈',  name: 'Water' },
    rubble: { icon: '▲',  name: 'Rubble' }
  };

  const DISC = {
    charms:  { name: 'Charms',  icon: '✨' },
    alchemy: { name: 'Alchemy', icon: '⚗️' },
    combat:  { name: 'Combat',  icon: '⚔️' },
    relics:  { name: 'Relics',  icon: '🗝️' },
    wards:   { name: 'Wards',   icon: '🛡️' },
    botany:  { name: 'Botany',  icon: '🌿' },
    beasts:  { name: 'Beasts',  icon: '🐾' }
  };

  const HOUSES = {
    ember: { name: 'Ember', color: '#e2603f' },
    tide:  { name: 'Tide',  color: '#4f8fe0' },
    gale:  { name: 'Gale',  color: '#3fb6a0' },
    thorn: { name: 'Thorn', color: '#d9b440' }
  };

  // castle:true = inside the castle. prot = protected (Hollow pawns can never enter)
  const NODES = {
    tower:     { name: 'Star Tower',        x: 290, y: 110, castle: true, fly: true, valor: true },
    study:     { name: "Warden's Study",    x: 520, y: 95,  castle: true, shield: true },
    hidden:    { name: 'Hidden Hall',       x: 640, y: 150, castle: true, hidden: true, prot: true },
    clock:     { name: 'Clock Tower',       x: 800, y: 110, castle: true, fly: true, shield: true },
    gallery:   { name: 'Portrait Gallery',  x: 400, y: 200, castle: true, valor: true, bonus: 'acquire' },
    stair:     { name: 'Shifting Stair',    x: 530, y: 245, castle: true, bonus: 'again' },
    relics:    { name: 'Relic Vault',       x: 700, y: 235, castle: true, token: 'relics', shield: true },
    charms:    { name: 'Charms Room',       x: 270, y: 290, castle: true, token: 'charms' },
    library:   { name: 'Library',           x: 410, y: 330, castle: true, library: true },
    wards:     { name: 'Warding Chamber',   x: 680, y: 345, castle: true, token: 'wards' },
    armory:    { name: 'Duelling Hall',     x: 830, y: 290, castle: true, token: 'combat' },
    hall:      { name: 'Great Hall',        x: 540, y: 395, castle: true, prot: true, start: true },
    kitchen:   { name: 'Kitchens',          x: 370, y: 455, castle: true, prot: true, bonus: 'draw' },
    alchemy:   { name: 'Alchemy Cellar',    x: 255, y: 520, castle: true, token: 'alchemy' },
    crypt:     { name: 'Crypt',             x: 460, y: 545, castle: true, shield: true },
    entrance:  { name: 'Entrance Hall',     x: 630, y: 500, castle: true },
    infirmary: { name: 'Infirmary',         x: 810, y: 455, castle: true, prot: true },
    courtyard: { name: 'Courtyard',         x: 610, y: 640 },
    gate:      { name: 'Iron Gate',         x: 820, y: 650, deploy: true },
    stables:   { name: 'Gryphon Stables',   x: 140, y: 590, token: 'beasts' },
    greenhouse:{ name: 'Glasshouses',       x: 330, y: 690, token: 'botany' },
    hut:       { name: "Keeper's Lodge",    x: 500, y: 765, prot: true },
    pitch:     { name: 'Skyball Pitch',     x: 690, y: 815, fly: true, bonus: 'draw' },
    bridge:    { name: 'Old Bridge',        x: 880, y: 790, deploy: true, valor: true },
    lake:      { name: 'Mirror Lake',       x: 130, y: 800, fly: true, deploy: true },
    boathouse: { name: 'Boathouse',         x: 300, y: 895, shield: true },
    forest:    { name: 'Whisperwood',       x: 520, y: 920, deploy: true },
    grove:     { name: 'Standing Stones',   x: 860, y: 925, shield: true }
  };

  // [a, b, obstacle?]  — edges touching 'hidden' only exist while the Hidden Hall is open
  const EDGES = [
    ['tower', 'gallery'], ['tower', 'charms'],
    ['gallery', 'study'], ['gallery', 'stair'], ['gallery', 'library', 'lock'],
    ['study', 'hidden'], ['hidden', 'relics'], ['study', 'stair', 'ward'], ['study', 'relics', 'lock'],
    ['clock', 'relics'], ['clock', 'armory'],
    ['stair', 'relics'], ['stair', 'hall'], ['stair', 'library'],
    ['relics', 'wards'],
    ['charms', 'library'], ['charms', 'alchemy', 'rubble'],
    ['library', 'hall'], ['library', 'kitchen'],
    ['wards', 'hall', 'ward'], ['wards', 'armory'], ['wards', 'entrance'],
    ['armory', 'infirmary'],
    ['hall', 'kitchen'], ['hall', 'entrance'],
    ['kitchen', 'alchemy'], ['kitchen', 'crypt', 'lock'],
    ['alchemy', 'crypt'], ['crypt', 'entrance', 'rubble'],
    ['entrance', 'infirmary'],
    ['entrance', 'courtyard'], ['alchemy', 'stables', 'rubble'], ['infirmary', 'gate', 'lock'],
    ['courtyard', 'gate'], ['courtyard', 'hut'], ['courtyard', 'greenhouse'], ['courtyard', 'pitch'],
    ['gate', 'bridge', 'water'], ['gate', 'pitch'],
    ['bridge', 'grove'], ['bridge', 'pitch'],
    ['pitch', 'hut'], ['pitch', 'grove', 'rubble'], ['pitch', 'forest'],
    ['hut', 'forest'], ['hut', 'greenhouse'],
    ['greenhouse', 'stables'], ['greenhouse', 'boathouse'],
    ['stables', 'lake', 'water'], ['lake', 'boathouse', 'water'],
    ['boathouse', 'forest'], ['forest', 'grove', 'water']
  ];

  // Secret passages: Wardens only, only with a card that allows it. Costs 1 step.
  const SECRETS = [
    ['library', 'crypt', '#5b8fd9'],
    ['kitchen', 'greenhouse', '#d65a5a'],
    ['armory', 'bridge', '#59b36a']
  ];

  const ADJ = {};
  Object.keys(NODES).forEach(k => (ADJ[k] = []));
  EDGES.forEach(([a, b, o]) => {
    const h = a === 'hidden' || b === 'hidden';
    ADJ[a].push({ to: b, obs: o || null, hidden: h });
    ADJ[b].push({ to: a, obs: o || null, hidden: h });
  });

  // ---------- CARDS ----------
  // Warden cards: mv = movement values ([n] single, [a,b] multi-move)
  const CARDS = {
    // starter
    quickstep:  { side: 'house', name: 'Quickstep',      mv: [3], disc: 'charms',  text: 'Move up to 3.' },
    lumen:      { side: 'house', name: 'Lumen',          mv: [2], disc: 'charms',  draw: 1, text: 'Draw 1 card. Move up to 2.' },
    unlatch:    { side: 'house', name: 'Unlatch',        mv: [3], disc: 'wards',   pass: ['lock'], text: 'Move up to 3. May pass Locked doors.' },
    wading:     { side: 'house', name: 'Wading Boots',   mv: [2], disc: 'botany',  pass: ['water'], text: 'Move up to 2. May cross Water.' },
    oldbroom:   { side: 'house', name: 'Old Broom',      mv: [2], disc: 'relics',  fly: true, text: 'Move up to 2. May fly between Fly points for free.' },
    twin:       { side: 'house', name: 'Twin Strides',   mv: [2, 2], disc: 'combat', text: 'Move 2 pawns 2 each, or 1 pawn 4.' },
    // acquire
    swift:      { side: 'house', name: 'Swift Feet',     mv: [4], disc: 'charms',  text: 'Move up to 4.' },
    skelkey:    { side: 'house', name: 'Skeleton Key',   mv: [4], disc: 'relics',  pass: ['lock'], text: 'Move up to 4. May pass Locked doors.' },
    dispel:     { side: 'house', name: 'Dispel',         mv: [3], disc: 'wards',   pass: ['ward'], text: 'Move up to 3. May pass Ward spells.' },
    shatter:    { side: 'house', name: 'Shatter',        mv: [3], disc: 'combat',  pass: ['rubble'], text: 'Move up to 3. May pass Rubble.' },
    tidewalk:   { side: 'house', name: 'Tidewalker',     mv: [3], disc: 'beasts',  pass: ['water'], text: 'Move up to 3. May cross Water.' },
    hidways:    { side: 'house', name: 'Hidden Ways',    mv: [3], disc: 'wards',   secret: true, text: 'Move up to 3. May use Secret passages.' },
    skybroom:   { side: 'house', name: 'Sky Broom',      mv: [3], disc: 'relics',  fly: true, text: 'Move up to 3. May fly between Fly points for free.' },
    gryphon:    { side: 'house', name: 'Gryphon Ride',   mv: [4], disc: 'beasts',  fly: true, pass: ['water'], text: 'Move up to 4. Fly between Fly points free; may cross Water.' },
    stunbolt:   { side: 'house', name: 'Stunning Bolt',  mv: [2], disc: 'combat',  stun: 2, text: 'Stun a Hollow pawn within 2 spaces of one of your pawns. Move up to 2.' },
    banish:     { side: 'house', name: 'Banish',         mv: [1], disc: 'combat',  banish: 1, text: 'Send a Hollow pawn within 1 space of your pawn back to the Hollow pool. Move up to 1.' },
    insight:    { side: 'house', name: 'Insight',        mv: [2], disc: 'charms',  draw: 2, text: 'Draw 2 cards. Move up to 2.' },
    secondwind: { side: 'house', name: 'Second Wind',    mv: [2], disc: 'alchemy', again: true, text: 'Move up to 2. Take 1 extra main action this turn.' },
    braveheart: { side: 'house', name: 'Brave Heart',    mv: [3], disc: 'combat',  valor: 1, text: 'Advance 1 on the Valor track. Move up to 3.' },
    pathfinder: { side: 'house', name: 'Pathfinder',     mv: [3, 3], disc: 'beasts', text: 'Move 2 pawns 3 each, or 1 pawn 6.' },
    rallycry:   { side: 'house', name: 'Rally Cry',      mv: [2, 2], disc: 'charms', standUp: true, text: 'Stand up all your stunned pawns. Move 2 pawns 2 each, or 1 pawn 4.' },
    aegis:      { side: 'house', name: 'Aegis Ward',     mv: [2], disc: 'wards',   react: 'bump', text: '⚡ Reaction: kept in hand, it cancels the next bump on your pawn (the Hollow pawn is stunned instead). Or play it to move up to 2.' },
    counter:    { side: 'house', name: 'Counterspell',   mv: [2], disc: 'charms',  react: 'target', text: '⚡ Reaction: kept in hand, it cancels the next Hollow card or event that targets you. Or play it to move up to 2.' },
    openair:    { side: 'house', name: 'Open Air',       mv: [3], disc: 'botany',  outside: 2, text: 'Move up to 3, or up to 5 if the pawn ends outside the castle.' },
    tonic:      { side: 'house', name: 'Herbal Tonic',   mv: [2], disc: 'alchemy', draw: 1, standUp: true, text: 'Draw 1 card and stand up your stunned pawns. Move up to 2.' },
    scholar:    { side: 'house', name: "Scholar's Path", mv: [],  disc: 'relics',  direct: 'library', text: 'Move one of your pawns directly to the Library.' },
    masterkey:  { side: 'house', name: 'Master Key',     mv: [4], disc: 'relics',  pass: ['lock', 'ward', 'water', 'rubble'], text: 'Move up to 4. May pass every obstacle.' },
    focus:      { side: 'house', name: 'Elixir of Focus',mv: [3], disc: 'alchemy', draw: 1, valor: 1, text: 'Draw 1 and advance 1 on the Valor track. Move up to 3.' },
    windstep:   { side: 'house', name: 'Wind Step',      mv: [5], disc: 'botany',  text: 'Move up to 5.' },

    // Hollow (shadow) cards. zone = the Shadow Path zone that unlocks the effect.
    creep:      { side: 'shadow', name: 'Creep',         mv: [3], text: 'Move up to 3.' },
    prowl:      { side: 'shadow', name: 'Prowl',         mv: [2, 2], text: 'Move 2 pawns 2 each, or 1 pawn 4.' },
    shadowstep: { side: 'shadow', name: 'Shadowstep',    mv: [2], fly: true, text: 'Move up to 2. May fly between Fly points for free.' },
    whisper:    { side: 'shadow', name: 'Whisper',       mv: [2], zone: 'white', eff: 'discard1', text: 'Dusk: a Warden of your choice discards 1 random card. Move up to 2.' },
    darkrally:  { side: 'shadow', name: 'Dark Rally',    mv: [2], zone: 'white', eff: 'draw1', text: 'Dusk: draw 1 card. Move up to 2.' },
    dreadgaze:  { side: 'shadow', name: 'Dread Gaze',    mv: [3], zone: 'orange', eff: 'stun1', text: 'Gloom: stun a Warden pawn within 1 space of a Hollow pawn. Move up to 3.' },
    swarm:      { side: 'shadow', name: 'Swarm',         mv: [3, 3], text: 'Move 2 pawns 3 each, or 1 pawn 6.' },
    hexbolt:    { side: 'shadow', name: 'Hex Bolt',      mv: [2], zone: 'white', eff: 'stun2', text: 'Dusk: stun a Warden pawn within 2 spaces of a Hollow pawn. Move up to 2.' },
    confound:   { side: 'shadow', name: 'Confound',      mv: [2], zone: 'orange', eff: 'skip', text: 'Gloom: a Warden of your choice skips their next turn. Move up to 2.' },
    nightrun:   { side: 'shadow', name: 'Night Run',     mv: [4], text: 'Move up to 4.' },
    summon:     { side: 'shadow', name: 'Summon',        mv: [2], zone: 'white', eff: 'deploy', text: 'Dusk: deploy a pawn from your pool for free. Move up to 2.' },
    pursuit:    { side: 'shadow', name: 'Pursuit',       mv: [5], text: 'Move up to 5.' },
    unravel:    { side: 'shadow', name: 'Unravel',       mv: [3], zone: 'orange', eff: 'discard2', text: 'Gloom: a Warden of your choice discards 2 random cards. Move up to 3.' },
    terror:     { side: 'shadow', name: 'Terror',        mv: [3], zone: 'red', eff: 'terror', text: 'Night: stun every Warden pawn within 1 space of any Hollow pawn. Move up to 3.' },
    gloom:      { side: 'shadow', name: 'Gloomcall',     mv: [3], zone: 'white', eff: 'draw2', text: 'Dusk: draw 2 cards. Move up to 3.' },
    steal:      { side: 'shadow', name: 'Steal Knowledge', mv: [3], zone: 'orange', eff: 'steal', text: 'Gloom: a Warden of your choice returns their Discipline token and drops 1 on the Valor track. Move up to 3.' }
  };

  const HOUSE_STARTER = ['quickstep', 'quickstep', 'lumen', 'unlatch', 'wading', 'oldbroom', 'twin'];
  const HOUSE_ACQUIRE = {
    swift: 3, skelkey: 2, dispel: 2, shatter: 2, tidewalk: 2, hidways: 2, skybroom: 2, gryphon: 1,
    stunbolt: 2, banish: 1, insight: 2, secondwind: 2, braveheart: 2, pathfinder: 2, rallycry: 1,
    aegis: 2, counter: 2, openair: 2, tonic: 2, scholar: 1, masterkey: 1, focus: 1, windstep: 1
  };
  const SHADOW_STARTER = ['creep', 'creep', 'prowl', 'shadowstep', 'whisper', 'darkrally', 'dreadgaze'];
  const SHADOW_ACQUIRE = { swarm: 2, hexbolt: 2, confound: 1, nightrun: 2, summon: 2, pursuit: 1, unravel: 1, terror: 1, gloom: 1, steal: 1 };

  const TOMES = {
    swiftness: { name: 'Tome of Swiftness',   text: 'Draw 2 cards.', n: 3 },
    valor:     { name: 'Tome of Valor',       text: 'Advance 1 on the Valor track.', n: 3 },
    learning:  { name: 'Tome of Learning',    text: 'Take the top card of the Spell deck into your hand.', n: 2 },
    mending:   { name: 'Tome of Mending',     text: 'Stand up all your pawns and draw 1 card.', n: 2 }
  };

  const ZONES = {
    white:  { name: 'Dusk',  color: '#cfc8b8', token: 'Cave Troll' },
    orange: { name: 'Gloom', color: '#e0893a', token: 'Night Wyrm' },
    red:    { name: 'Night', color: '#c23b3b', token: 'Hollow Wraith' }
  };
  const ZONE_ORDER = ['white', 'orange', 'red'];

  // 16 spaces. Event spaces trigger an event card of that zone.
  const PATH = [
    { zone: 'white' }, { zone: 'white' }, { zone: 'white', event: true }, { zone: 'white' }, { zone: 'white', event: true, last: true }, { zone: 'white' },
    { zone: 'orange' }, { zone: 'orange', event: true }, { zone: 'orange' }, { zone: 'orange', event: true, last: true }, { zone: 'orange' },
    { zone: 'red' }, { zone: 'red', event: true, need: 3 }, { zone: 'red' }, { zone: 'red', event: true, need: 2, last: true }, { zone: 'red', final: true, need: 1 }
  ];

  const EVENTS = {
    w1: { zone: 'white',  name: 'Restless Night',  house: 'draw1',     houseText: 'Every Warden draws 1 card.',                         dark: 'draw2',      darkText: 'Hollow draws 2 cards.' },
    w2: { zone: 'white',  name: 'Creeping Fog',    house: 'disc1',     houseText: 'Every Warden discards 1 random card.',               dark: 'deploy1',    darkText: 'Hollow deploys 1 pawn for free.' },
    w3: { zone: 'white',  name: 'Chill Wind',      house: 'stunOut1',  houseText: 'Each Warden: one pawn outside the castle is stunned.', dark: 'draw1',     darkText: 'Hollow draws 1 card.' },
    w4: { zone: 'white',  name: 'Rumours',         house: 'loseToken', houseText: 'Every Warden returns their Discipline token.',       dark: 'acq',        darkText: 'Hollow takes the top Hollow spell into hand.' },
    w5: { zone: 'white',  name: 'Calm Before',     house: 'standAll',  houseText: 'All Warden pawns stand up.',                         dark: 'standDraw1', darkText: 'Hollow pawns stand up; Hollow draws 1.' },
    o1: { zone: 'orange', name: 'Darkening Sky',   house: 'disc2',     houseText: 'Every Warden discards 2 random cards.',              dark: 'draw2',      darkText: 'Hollow draws 2 cards.' },
    o2: { zone: 'orange', name: 'Ambush',          house: 'stunOutAll',houseText: 'Every Warden pawn outside the castle is stunned.',   dark: 'deploy2',    darkText: 'Hollow deploys up to 2 pawns for free.' },
    o3: { zone: 'orange', name: 'Doubt',           house: 'valor1',    houseText: 'Every Warden drops 1 on the Valor track.',           dark: 'standDraw1', darkText: 'Hollow pawns stand up; Hollow draws 1.' },
    o4: { zone: 'orange', name: 'Breach',          house: 'loseToken', houseText: 'Every Warden returns their Discipline token.',       dark: 'deployDraw', darkText: 'Hollow deploys 1 pawn and draws 1.' },
    o5: { zone: 'orange', name: 'Lockdown',        house: 'refresh',   houseText: 'Every Warden discards 1 random card; both spell rows are replaced.', dark: 'acq', darkText: 'Hollow takes the top Hollow spell into hand.' },
    r1: { zone: 'red',    name: 'Siege',           house: 'siege',     houseText: 'Every Warden discards 2 random cards and every pawn outside the castle is stunned.', dark: 'deploy2', darkText: 'Hollow deploys up to 2 pawns.' },
    r2: { zone: 'red',    name: 'Despair',         house: 'valor2',    houseText: 'Every Warden drops 2 on the Valor track.',           dark: 'draw2',      darkText: 'Hollow draws 2 cards.' },
    r3: { zone: 'red',    name: 'Collapse',        house: 'stunUnprot',houseText: 'Every Warden pawn not in a protected space is stunned.', dark: 'draw1',   darkText: 'Hollow draws 1 card.' },
    r4: { zone: 'red',    name: 'The Hunt',        house: 'hand2',     houseText: 'Every Warden discards at random down to 2 cards.',   dark: 'deployStand',darkText: 'Hollow deploys 1 pawn; Hollow pawns stand up.' },
    r5: { zone: 'red',    name: 'Darkest Hour',    house: 'combo',     houseText: 'Every Warden discards 1 random card, returns their token and drops 1 Valor.', dark: 'draw2', darkText: 'Hollow draws 2 cards.' }
  };

  const DARK_LOCS = ['study', 'crypt', 'clock', 'relics'];
  const DEPLOY = Object.keys(NODES).filter(k => NODES[k].deploy);
  const SHIELD_NODES = Object.keys(NODES).filter(k => NODES[k].shield);
  const HOUSE_LOCS = Object.keys(NODES).filter(k => !NODES[k].start && !NODES[k].hidden);

  // ---------- MOVEMENT ----------
  // opts: { side:'house'|'shadow', pass:[], fly:bool, secret:bool, hiddenOpen:bool }
  function neighbours(node, opts) {
    const out = [];
    const N = NODES[node];
    if (opts.side === 'house' && N.hidden && !opts.hiddenOpen) return out; // trapped while closed
    for (const e of ADJ[node]) {
      if (e.hidden && (opts.side === 'shadow' || !opts.hiddenOpen)) continue;
      if (opts.side === 'shadow') {
        if (NODES[e.to].prot) continue;
      } else if (e.obs && !(opts.pass || []).includes(e.obs)) continue;
      out.push({ to: e.to, cost: 1 });
    }
    if (opts.side === 'house' && opts.secret) {
      for (const [a, b] of SECRETS) {
        if (a === node) out.push({ to: b, cost: 1 });
        if (b === node) out.push({ to: a, cost: 1 });
      }
    }
    if (opts.fly && N.fly) {
      for (const k in NODES) if (k !== node && NODES[k].fly && !(opts.side === 'shadow' && NODES[k].prot)) out.push({ to: k, cost: 0 });
    }
    return out;
  }

  function stepCost(a, b, opts) {
    let best = -1;
    for (const n of neighbours(a, opts)) if (n.to === b && (best < 0 || n.cost < best)) best = n.cost;
    return best;
  }

  // Validate a path [start, ..., end]; returns total cost or -1
  function pathCost(path, opts) {
    if (!Array.isArray(path) || path.length < 2) return -1;
    const seen = new Set([path[0]]);
    let cost = 0;
    for (let i = 1; i < path.length; i++) {
      if (!NODES[path[i]] || seen.has(path[i])) return -1;
      const c = stepCost(path[i - 1], path[i], opts);
      if (c < 0) return -1;
      cost += c; seen.add(path[i]);
    }
    return cost;
  }

  // Cheapest paths from a start node (0-1 BFS). Returns {node:{cost, path}}
  function reachable(from, opts, budget) {
    const best = { [from]: { cost: 0, path: [from] } };
    const dq = [from];
    while (dq.length) {
      const cur = dq.shift();
      const base = best[cur];
      for (const n of neighbours(cur, opts)) {
        const c = base.cost + n.cost;
        if (c > budget) continue;
        if (!best[n.to] || c < best[n.to].cost) {
          best[n.to] = { cost: c, path: base.path.concat(n.to) };
          if (n.cost === 0) dq.unshift(n.to); else dq.push(n.to);
        }
      }
    }
    delete best[from];
    return best;
  }

  // Plain distance (ignores obstacles) for "within N spaces"
  function distance(a, b, hiddenOpen) {
    if (a === b) return 0;
    const seen = { [a]: 0 }; const q = [a];
    while (q.length) {
      const c = q.shift();
      for (const e of ADJ[c]) {
        if (e.hidden && !hiddenOpen) continue;
        if (seen[e.to] === undefined) { seen[e.to] = seen[c] + 1; if (e.to === b) return seen[e.to]; q.push(e.to); }
      }
    }
    return 99;
  }

  return { OBS, DISC, HOUSES, NODES, EDGES, SECRETS, ADJ, CARDS, HOUSE_STARTER, HOUSE_ACQUIRE, SHADOW_STARTER, SHADOW_ACQUIRE,
    TOMES, ZONES, ZONE_ORDER, PATH, EVENTS, DARK_LOCS, DEPLOY, SHIELD_NODES, HOUSE_LOCS,
    neighbours, stepCost, pathCost, reachable, distance };
});
