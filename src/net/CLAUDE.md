# net/ — transports, room codes, protocol, lobby

**Never imported by `sim/`.** Net play is a command source and a lobby UI concern layered
*outside* the deterministic core; `sim/` stays reconstructible from `(state, commands)` alone
whether those commands came from a keyboard or a peer. See `sim/CLAUDE.md`.

**Freely uses `Map`/`Set`/`crypto.randomUUID()`** — the sim-purity ban on those (see
`scripts/check-sim-purity.mjs`) only applies inside `src/sim/`. Nothing here needs to be
JSON-serializable or replay-deterministic across engines.

## Layering

```
transport.ts (interface)  ──implemented by──>  broadcast.ts / loopback.ts / (M4) trystero.ts
        ↑
     lobby.ts (host-authoritative state machine, protocol.ts message shapes)
        ↑
   game/netscreens.ts (NetMenu / NetLobby DOM screens, flow.ts phases)
```

- `transport.ts` — `NetTransport`: `join(roomCode)`/`leave()`, `send(kind, payload, to?)`,
  `onMessage`/`onPeerJoin`/`onPeerLeave`. A generic named-message pub/sub plus peer presence;
  no protocol semantics live here.
- `broadcast.ts` — same-origin `BroadcastChannel`, the M2-M3 default. Layers its own presence
  protocol (`hello`/`here`/`bye`) on top since `BroadcastChannel` has no peer discovery.
  **Does not cross Playwright browser contexts** — two-peer tests need two *pages* in one context.
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
  `StartMessage` is defined but unused until M3.

## Invariants M3's lockstep will rely on

- **Every client runs the identical tick sequence per confirmed tick**: `step(state, commands)` →
  `flow.handleEvents(state)` → `flow.tick()`, in that order, with the same `commands` map on every
  peer for a given tick number. `game/app.ts`'s `runTick()` is that sequence today for the local
  session; `NetSession` (M3) must call it the same way, just sourcing remote slots' commands from
  received `input` packets instead of `keyboard.readCommand()`.
- **No local sim mutation on peer events.** A peer joining/leaving/picking a loadout is lobby
  state, not sim state — nothing in `net/` ever reaches into `GameState` directly. The only sim
  entry point net play uses is the same `commands: Record<tankId, Command>` that local input
  already builds (see `createInitialState`/`resetGameWithRoster`, `sim/CLAUDE.md`).
- **`flow.handleEvents` must stay a pure function of `state.events`** (this tick's scratch array) —
  it must not read wall-clock time or any net-layer state, or two peers running it after an
  identical `step()` could diverge in phase transitions (e.g. one peer seeing `LevelComplete`
  handled a tick "later" than another). This already holds as of M2; don't add anything to
  `flow.ts` that reads outside `state`/its own fields when M3 wires session control through it.
- Roster slots (`RosterEntry.slot`, host-assigned in `lobby.ts`) become `PlayerSpec` array index
  when M3 calls `createInitialState`/`resetGameWithRoster` — keep them dense and 0-based going in.

## M2 verification notes

`BroadcastChannel` doesn't cross Playwright *browser contexts*, only *pages within one context*
(same origin, same partition). Two-tab choreography tests must open two pages in a single
context/tab set, not two separate contexts. `?net=` forces a transport (`bc` today); leaving it
unset also picks `bc` until M4 adds `trystero`.
