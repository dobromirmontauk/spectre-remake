export interface DecisionAudit {
  id: string; browserSessionId: string; sequence: number; tick: number; level: number; at: string;
  request: unknown; response?: unknown; responseText?: string; latencyMs?: number;
  outcome: 'pending' | 'accepted' | 'stale' | 'failed' | 'canceled' | 'budget';
  error?: string;
  decisions: { tankId: string; role: string; choice: string; description: string; strategy?: string; confidence?: number; callId?: string; accepted: boolean; notAppliedReason?: 'superseded' | 'expired' | 'session reset' | 'life ended' | 'budget exhausted'; applied: boolean; appliedTick?: number }[];
}
// Browser attempts survive refresh independently of the provider's server audit.
// This store never receives credentials. The session retains only its latest rows.
export class DecisionAuditStore {
  readonly sessionId = crypto.randomUUID();
  private db: Promise<IDBDatabase | null>;
  private fallback: DecisionAudit[] = [];
  private writes: Promise<void> = Promise.resolve();
  constructor() {
    this.db = typeof indexedDB === 'undefined' ? Promise.resolve(null) : new Promise(resolve => {
      const open = indexedDB.open('spectre-jev-audit', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('batches', { keyPath: 'id' });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
    });
  }
  save(record: DecisionAudit): void {
    const snapshot = structuredClone(record);
    this.writes = this.writes.then(async () => {
      const db = await this.db;
      if (!db) { const i = this.fallback.findIndex(r => r.id === snapshot.id); if (i < 0) this.fallback.push(snapshot); else this.fallback[i] = snapshot; return; }
      await new Promise<void>(resolve => {
        const tx = db.transaction('batches', 'readwrite'); tx.objectStore('batches').put(snapshot);
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
      });
    });
  }
  async exportAll(): Promise<DecisionAudit[]> {
    await this.writes; const db = await this.db;
    if (!db) return structuredClone(this.fallback);
    return await new Promise(resolve => {
      const read = db.transaction('batches', 'readonly').objectStore('batches').getAll();
      read.onsuccess = () => resolve(read.result as DecisionAudit[]); read.onerror = () => resolve([]);
    });
  }
}
