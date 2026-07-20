# net/ — transports, room codes, protocol, lobby

**Never imported by `sim/`.** Net play is a command source and a lobby UI concern layered
*outside* the deterministic core; `sim/` stays reconstructible from `(state, commands)` alone
whether those commands came from a keyboard or a peer. See `sim/CLAUDE.md`.

**Freely uses `Map`/`Set`/`crypto.randomUUID()`** — the sim-purity ban on those (see
`scripts/check-sim-purity.mjs`) only applies inside `src/sim/`. Nothing here needs to be
JSON-serializable or replay-deterministic across engines.

## Layering

```
transport.ts (interface)  ──implemented by──>  broadcast.ts / loopback.ts / trystero.ts (M4)
        ↑
     lobby.ts (host-authoritative state machine, protocol.ts message shapes)
        ↑
   game/netscreens.ts (NetMenu / NetLobby DOM screens, flow.ts phases)
        ↑
     lockstep.ts (delayed-input command exchange + hash-based desync detection)
        ↑
     session.ts (PlaySession: LocalSession / NetSession — game/app.ts's only net dependency)
```

- `transport.ts` — `NetTransport`: `join(roomCode)`/`leave()`, `send(kind, payload, to?)`,
  `onMessage`/`onPeerJoin`/`onPeerLeave`. A generic named-message pub/sub plus peer presence;
  no protocol semantics live here.
- `broadcast.ts` — same-origin `BroadcastChannel`. Layers its own presence protocol
  (`hello`/`here`/`bye`) on top since `BroadcastChannel` has no peer discovery. **Does not cross
  Playwright browser contexts** — two-peer tests need two *pages* in one context. Forced via
  `?net=bc`; kept as the deterministic no-network test path (see M2/M3 verification notes below).
- `trystero.ts` — `TrysteroTransport` (M4), the **default** transport: real cross-browser WebRTC
  DataChannels signaled over the public Nostr relay network (`trystero/nostr`, dynamically
  imported inside `join()` only, so the base game never pays for it — see createTransport.ts).
  `TRYSTERO_APP_ID`/`TRYSTERO_RELAY_URLS`/`NET_JOIN_TIMEOUT_MS` live in `config/constants.ts`.
  Every `NetMessageKind` (protocol.ts) maps straight to a trystero action namespace of the same
  name — all are ≤11 ASCII bytes, under even the historical 12-byte action-name limit, so no
  truncation table is needed. `join()` resolves once at least one pinned relay's WebSocket opens
  (`waitForRelay()`, racing `NET_JOIN_TIMEOUT_MS`) — this is "relay unreachable," a transport-level
  concern distinct from `lobby.ts`'s own `NET_ROOM_NOT_FOUND_TIMEOUT_MS` ("relay reachable, but
  nobody answered `hello`"), and the two run concurrently (lobby.ts's not-found timer starts the
  instant `NetLobby.join()` is called, not after `transport.join()` resolves).
  - **`pendingSends` — a real bug found under actual cross-machine testing, not a defensive
    nicety**: `lobby.ts`'s `join()` sends `hello` the instant `transport.join()` resolves. For
    BroadcastChannel/Loopback that's fine (no connection-setup latency at that layer). Over a real
    P2P transport, though, "relay reachable" and "connected to the host peer" are two different
    moments — the WebRTC handshake is still in flight when `hello` gets sent, trystero's own
    `action.send()` silently delivers to zero peers (not an error, just a no-op), and the `hello`
    is gone for good. `TrysteroTransport` queues any send whose target(s) aren't yet in its
    `activePeers` set (trystero's own `onPeerJoin`-activated peers) and replays the queue — through
    `send()` itself, so a still-pending specific `to` target just re-queues — the moment a peer
    activates. Confirmed against real public relays: without this, two separate browser contexts
    would connect at the WebRTC layer (data visibly flowing both ways) but the lobby would never
    see a second roster entry, because the joiner's one and only `hello` had already been dropped.
- `loopback.ts` — in-memory bus keyed by room code, for same-page multi-peer harnesses (M5's
  8-player test) and lobby unit tests without a real message channel.
- `roomcode.ts` — 5-char Crockford base32 (minus I/L/O/U/0/1), `crypto.getRandomValues`.
- `protocol.ts` — message shapes (`hello`/`reject`/`lobby`/`loadoutPick`/`start`/`bye`).
  `PROTOCOL_VERSION` lives in `config/constants.ts`; `BUILD_HASH` comes from the Vite
  `__BUILD_HASH__` define (`git rev-parse --short HEAD`, `'dev'` outside a git checkout).
  Version check is strict on `protoVersion`; `buildHash` is enforced only when *both* sides are
  non-`'dev'` (so `npm run dev` against `npm run dev` never spuriously rejects).
- `lobby.ts` — `NetLobby`: host assigns slots and is the sole writer of roster/mode; every
  change is a fresh `lobby` broadcast that joiners simply adopt (no last-write-wins race).
  `startMatch(level, inputDelay)` (host-only) sends `start` and fires `onStart()` locally (the
  host never receives its own broadcast — see broadcast.ts/loopback.ts — so it takes the exact
  same `StartMessage` path as every joiner). `markMatchEnded()` resets the "match in progress"
  gate so the host can Start another once everyone's back in the lobby (see game/app.ts's
  GameOver→NetLobby path).

## Protocol (M3): packing, lockstep messages, hash exchange

- **Command packing** (`protocol.ts` `packCommand`/`unpackCommand`): one integer 0-63 — turn
  (2 bits, value+1), thrust (2 bits, value+1), fire (1 bit), grenade (1 bit). Round-trip verified
  for all 36 `Command` combinations (scratch check in the M3 commit).
- **`input` message** (`InputMessage {slot, firstTick, cmds}`): one player slot's packed commands
  for a run of ticks starting at `firstTick`. Sent once per locally-scheduled tick, always
  covering the last `INPUT_REDUNDANCY` ticks (belt-and-suspenders over a reliable-ordered
  channel) — *except* right after a withheld/suppressed send (see lockstep.ts below), when it
  widens to cover the whole gap instead.
- **`hash` message** (`HashMessage {tick, hash}`): `sim/hash.ts`'s `hashState()` at every
  `HASH_INTERVAL_TICKS` (60) tick boundary. Compared against every OTHER peer's hash for the same
  tick the instant both are known (whichever arrives second triggers the compare per-peer);
  mismatch raises desync via `Lockstep.onDesync()`. `pendingPeerHashes` is keyed
  `Map<tick, Map<peerId, hash>>`, not just `Map<tick, hash>` — **a real bug found under M5's
  3-player testing**: with only 2 peers there's exactly one other hash to wait for per tick, so a
  single-slot map happened to work, but with 3+ players every peer receives a `hash` from EACH
  other peer for the same tick, and a tick-only key let one peer's hash silently clobber another's
  before the local hash arrived to compare against it — producing a false-positive "Out of Sync"
  the moment the wrong (clobbering) peer's hash got compared instead. Never exercised by M3/M4,
  which only ever tested two-peer matches.
- **`drop` message** (`DropMessage {slot, effectiveTick}`): host-authoritative player removal (M5,
  see "Disconnect robustness" below) — every peer applies `sim/simulation.ts` `removePlayer(slot)`
  at the identical `effectiveTick`.
- **`start` message** (already shaped in M2): `{mode, level, roster, inputDelay}` — `inputDelay`
  is `NET_INPUT_DELAY_TICKS` (config/constants.ts), carried on the wire so a future adaptive-delay
  scheme doesn't need a protocol change.

## `lockstep.ts` — delayed-input command exchange + desync detection

- Per-(slot, tick) command buffers (`Map<slot, Map<tick, Command>>` — fine to use `Map` here,
  the sim-purity ban is `sim/`-only). Ticks `0..D-1` (`D` = `NET_INPUT_DELAY_TICKS`) are
  pre-seeded `NEUTRAL_COMMAND` for every live slot so a match starts stepping immediately.
- `commandsForNextTick(readLocalCommand)`: for the next unconfirmed tick `T`, samples the local
  input **once** (assigned to `T+D`) the first time `T` is attempted, but retries the broadcast
  **every** call regardless — this is what lets a transient withheld send (a real hiccup, or the
  `debugStallInject` test hook) catch up the moment conditions clear, instead of only getting a
  single shot at the moment of sampling. Returns `null` (accumulator stalls) until every live
  slot has a command for `T`; `canStep(tick)`/`missingSlots(tick)` expose the same check for the
  stall-overlay UI (see `session.ts` `NetSession.missingNames()`).
  - **This retry behavior was a real bug, not just a debug-hook nicety**: once a peer stalls, its
    tick number freezes, and *both* peers can end up mutually stalled within a few ticks (each
    waiting on the other) — with the broadcast gated behind "only on a fresh sample," neither
    side would ever retry, deadlocking the match permanently on any transient send gap. Always
    retrying the broadcast on every poll (cheap — same tick, same packet, until it changes) is
    what makes recovery actually happen instead of just being theoretically possible.
- Own hashes are kept in a ring of the last `NET_HASH_RING_SIZE` (10) boundaries for
  `__game.net.hashAtTick()`; a peer's hash for a tick we haven't hashed yet is buffered and
  compared the moment we do.

## `session.ts` — `PlaySession`: the only net dependency `game/app.ts` has

- `LocalSession` reproduces pre-M3 behavior exactly (including the debug `pressCommand`
  override path) — `localSlots()` is `[0,1]` in local split-screen, `[0]` everywhere else.
- `NetSession` wraps one `Lockstep` + the roster; `localSlots()` is always `[mySlot]` — net play
  renders **one** viewport following the local player regardless of roster size (see
  `game/app.ts`'s `split` vs `multiplayer` distinction and `src/hud/style.css`'s
  `data-splitscreen`/`data-multiplayer` attributes, which are independent for exactly this
  reason). Every net client drives with the P1 keyboard scheme locally regardless of slot — each
  client is "player 1" on its own keyboard.
- `afterTick(state)` is called once per confirmed tick, right after
  `step()`→`flow.handleEvents()`→`flow.tick()` (never in between — see the invariant below); it
  only *observes* `state` (hash exchange), never mutates it.
- State-mutating debug hooks (`setLevel`/`setGod`/`setLives`/`spawnEnemyAt`/`killAllEnemies`/
  `collectAllFlags`/`restart`/`startGame`/`stepTicks`) throw in net sessions (`game/app.ts`'s
  `assertLocal()`) — ticks are gated by the network, and state must stay reconstructible from
  the same lockstep-confirmed commands on every peer.
- `flow.paused` is set by the match-ended/desync dialogs (see `game/app.ts`
  `showMatchEndedDialog`) to freeze the frame behind them — `goToNetMenu()`/`goToNetLobby()`
  (`game/flow.ts`) both reset it, same as `goToMenu()`, since net sessions disable the pause key
  entirely (`isPauseAllowed()` is always `false`) and nothing else would ever clear it. Forgetting
  this reset was a real M3 bug: it permanently froze the *next* net match after any dialog fired.

## Invariants (established M2, still load-bearing in M3)

- **Every client runs the identical tick sequence per confirmed tick**: `step(state, commands)` →
  `flow.handleEvents(state)` → `flow.tick()`, in that order, with the same `commands` map on every
  peer for a given tick number. `game/app.ts`'s `runTick()` is that sequence; `NetSession.afterTick`
  runs strictly after it, never interleaved.
- **No local sim mutation on peer events.** A peer joining/leaving/picking a loadout is lobby
  state, not sim state — nothing in `net/` ever reaches into `GameState` directly. The only sim
  entry point net play uses is the same `commands: Record<tankId, Command>` that local input
  already builds (see `createInitialState`/`resetGameWithRoster`, `sim/CLAUDE.md`).
- **`flow.handleEvents` must stay a pure function of `state.events`** (this tick's scratch array) —
  it must not read wall-clock time or any net-layer state, or two peers running it after an
  identical `step()` could diverge in phase transitions.
- Roster slots (`RosterEntry.slot`, host-assigned in `lobby.ts`) become `PlayerSpec` array index
  in `startNetMatch()` (`game/app.ts`) — sorted by slot before calling
  `createInitialState`/`resetGameWithRoster`, so every peer builds the identical players array
  regardless of join order.

## Disconnect robustness (M5 — replaces M3's "simple" peer-left-ends-match)

A regular peer leaving mid-match no longer ends the match — only the **host** leaving still does
(unchanged from M3) and a hash mismatch still does (**Desync**, `Lockstep.onDesync`: "The game
fell out of sync — match ended."). `NetSession` tells these apart via a dedicated `onHostLeft`
callback (compares the departing peerId against `hostPeerId`, threaded through `MatchStartInfo`)
— a regular peer departing goes through the grace/drop protocol below instead of a dialog.

- **Detection, immediate (every peer)**: `Lockstep`'s own `transport.onPeerLeave` subscription
  marks that roster slot **orphaned** the instant it fires — `missingSlots`/`canStep` stop waiting
  on it and `commandsForNextTick` fills `NEUTRAL_COMMAND` for any tick it has no real buffered
  command for. This has to happen unconditionally and immediately, not gated on host authority:
  a genuinely silent slot would otherwise block `canStep()` for every peer forever (nobody can
  advance past the tick where a required slot's command never arrives), which would also prevent
  ever reaching the tick where a drop could apply.
- **Grace timer (host-only)**: on that same detection, the host additionally arms a wall-clock
  timer (`DISCONNECT_GRACE_TICKS`, 150 ticks worth of ms — deliberately wall-clock, not tick-based,
  since it must keep running even while `canStep()` is genuinely blocked and ticks aren't
  advancing). Once elapsed, the host broadcasts an authoritative `drop {slot, effectiveTick}`
  (`effectiveTick` = the host's current `nextTick + inputDelay`, the same lead time a normal input
  packet gets so every peer's handling has time to arrive before their own sim reaches that tick).
- **Zombie detection (host-only)**: a slot whose transport connection is still technically open
  but has sent no `input` packet in `ZOMBIE_TIMEOUT_MS` (10s — see `__game.net.debugStallInject`,
  which suppresses a client's own outbound broadcast to simulate exactly this) gets dropped
  immediately, no additional grace layered on top of the timeout already waited out.
- **Both host-side checks run inside `Lockstep.commandsForNextTick()`**, not a tick-gated callback
  — `app.ts` calls this once per rendered frame regardless of whether the sim is stalled, which is
  the only way the host's own bookkeeping can keep running while it too is blocked waiting on the
  silent slot (an `afterTick`-style hook, gated on a tick actually completing, would never fire).
- **Application**: every peer that receives (or, for the host, originates) a `drop` records it via
  `scheduleDrop` (which also marks the slot orphaned, covering the zombie case for non-host peers
  that have no independent signal — their connection to the stalled peer never closes, so the
  `drop` message IS their only evidence). `Lockstep.takeDueDrops()` — called from
  `NetSession.dueDrops()`, in turn called by `game/app.ts`'s accumulator loop right after a
  successful `commandsForNextTick()`, before `step()` runs that tick — returns any slot whose
  `effectiveTick` has been reached, and `step(state, commands, drops)` applies
  `sim/simulation.ts`'s `removePlayer(state, slot, events)` for it at the very start of that tick,
  same deterministic-message-driven pattern as commands themselves (see sim/CLAUDE.md).
- **"NAME left the game" toast** (`PLAYER_LEFT_TOAST_MS`, ~3s, `game/app.ts`): driven by the
  `PlayerLeft` sim event `removePlayer` emits — fires at the identical tick on every peer, not at
  whatever real time each one happened to notice the disconnect.
- Esc "Leave match?" confirm and the Host-Left/Desync dialogs' OK do the same full teardown:
  dispose the `NetSession`, `NetLobby.leave()`, back to NetMenu. A **normal** GameOver instead
  returns everyone to NetLobby with the room/transport still alive (`markMatchEnded()` +
  `flow.goToNetLobby()`) so the host can Start another — state is fully rebuilt every match, so
  this is safe (but see the rng-reseed note below: it must ACTUALLY be fully rebuilt).

## M5 note: a fresh match must reseed `state.rng`, not just reset ids

`resetGameWithRoster` (every net match's entry point) resets `tick`/`score`/`nextEntityId` but,
until M5, never touched `state.rng` — it kept whatever mulberry32 state the SAME browser tab's
long-lived `state` object had left over from any prior match (a local game played before joining
Net Play, or an earlier net match on the same page). Two peers starting a new match with different
leftover `rng.state` look byte-identical at every tick (same commands, same positions, same enemy
roster/spawns — none of that touches `state.rng`) right up until the first `state.rng.next()` call
(an enemy fire-cooldown jitter, a respawn edge-point pick, an unstick-direction roll) — which then
draws a DIFFERENT value on each peer, and `hash.ts` hashes `rng.state` directly, so the very next
`HASH_INTERVAL_TICKS` boundary raises a false "Out of Sync" even though nothing about the match
itself was wrong. Found via the 8-player smoke test (4 tabs mid-reuse, 4 freshly loaded — full
state dumps at the frozen tick were identical in every field except `rng.state` and one enemy's
`fireCooldown`); fixed by reseeding via `createRng(LEVELGEN_SEED_BASE ^ level)` in both
`resetGameWithRoster` and the debug `resetGame` (restart hook), matching `createInitialState`.
**Implication for hand-driven verification**: reusing the same browser tab/page across multiple
test matches is exactly the scenario that used to trigger this — no longer a problem now that it's
fixed, but worth remembering if a *future* change reintroduces some other un-reseeded piece of
state that `hash.ts` depends on.

## M2/M3/M4/M5 verification notes

`BroadcastChannel` doesn't cross Playwright *browser contexts*, only *pages within one context*
(same origin, same partition). Two-tab choreography tests with `?net=bc` must open two pages in a
single context/tab set, not two separate contexts. Leaving `?net=` unset (the real scenario, and
the one that must use two *separate* contexts to mean anything) picks `TrysteroTransport` and goes
over real public relays + WebRTC — network-dependent, and per-relay flakiness is real (a specific
relay rate-limiting a test IP is not the same as the transport being broken; a pinned relay list of
5 is deliberately redundant against exactly this). Verified end to end against real relays: two
separate Playwright browser contexts (different storage, proving BroadcastChannel could not have
bridged them) host/join, sync a roster, start a co-op match, and produce matching
`hashAtTick()` at every compared tick boundary.

`debugStallInject(ms)`/`debugCorruptState()`/`confirmedTick()`/`hashAtTick(tick)`/`startMatch()`
live under `__game.net` (see `game/debug.ts`). `debugCorruptState()` must corrupt something the
sim's own invariants don't silently heal before the next hash boundary — nudging a position is
*not* enough, since the arena-clamp/collision pass re-clamps every tick (see `sim/CLAUDE.md`'s
tick order); flipping a bit of `state.rng.state` has no such self-correction and reliably
diverges the hash within one `HASH_INTERVAL_TICKS` window.
