// `?net=` URL param selects the transport implementation. Default (no
// param, or any unrecognized value) is TrysteroTransport — real cross-
// browser relays, M4's whole point. `?net=bc` forces same-origin
// BroadcastChannel, kept as the deterministic two-tab test path (see
// net/CLAUDE.md) since it has no network round trip to flake on.
//
// TrysteroTransport's constructor is cheap (no dynamic import happens until
// its join() runs — see net/trystero.ts), so eagerly `new`-ing it here on
// every Host/Join click doesn't cost anything until the click actually
// tries to reach a relay.

import type { NetTransport } from './transport.ts';
import { BroadcastChannelTransport } from './broadcast.ts';
import { TrysteroTransport } from './trystero.ts';

function requestedKind(): 'bc' | 'trystero' {
  return new URLSearchParams(window.location.search).get('net') === 'bc' ? 'bc' : 'trystero';
}

export function createTransport(): NetTransport {
  return requestedKind() === 'bc' ? new BroadcastChannelTransport() : new TrysteroTransport();
}

// NetMenu's "via relay network" / "same-browser mode" indicator (see
// game/netscreens.ts) — reads the same `?net=` param createTransport() does,
// so the label is knowable before Host/Join is even clicked and can never
// drift from what createTransport() actually builds.
export function transportLabel(): string {
  return requestedKind() === 'bc' ? 'same-browser mode' : 'via relay network';
}
