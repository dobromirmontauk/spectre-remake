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
  `HASH_INTERVAL_TICKS` (60) tick boundary. Compared against the peer's hash for the same tick
  the instant both are known (whichever arrives second triggers the compare); mismatch raises
  desync via `Lockstep.onDesync()`.
- **`drop` message** (`DropMessage {slot, effectiveTick}`): type only in M3 — the host-authoritative
  grace/drop protocol is M5. Peers that receive it today can ignore it.
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

## Disconnect/desync handling (M3 v1 — "simple"; full grace/drop protocol is M5)

- **Peer leave mid-match** (transport `onPeerLeave`, which already covers both an explicit `bye`
  and a crash/tab-close — see broadcast.ts): shows "\<name\> left — match ended" and ends the
  match for everyone, same path whether the peer who left was host or not (gameplay itself is
  symmetric — no host authority needed once a match is running).
- **Desync** (`Lockstep.onDesync`): "The game fell out of sync — match ended."
- Both dialogs' OK, and the voluntary Esc "Leave match?" confirm, do the same full teardown:
  dispose the `NetSession`, `NetLobby.leave()`, back to NetMenu. A **normal** GameOver instead
  returns everyone to NetLobby with the room/transport still alive (`markMatchEnded()` +
  `flow.goToNetLobby()`) so the host can Start another — state is fully rebuilt every match, so
  this is safe.

## M2/M3/M4 verification notes

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
