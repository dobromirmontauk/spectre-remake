// `?net=` URL param selects the transport implementation. Only 'bc'
// (BroadcastChannel) exists today; it's also the default until
// TrysteroTransport lands in M4. Any other/unrecognized value falls back to
// 'bc' rather than throwing, so a stray query param never breaks Net Play.

import type { NetTransport } from './transport.ts';
import { BroadcastChannelTransport } from './broadcast.ts';

export function createTransport(): NetTransport {
  const requested = new URLSearchParams(window.location.search).get('net');
  switch (requested) {
    case 'bc':
    default:
      return new BroadcastChannelTransport();
  }
}
