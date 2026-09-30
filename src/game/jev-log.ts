import { SIM_DT } from '../config/constants.ts';
import type { TankObservation } from '../jev/types.ts';
import type { JevSession } from './jev-session.ts';
import type { DecisionAudit } from './jev-audit.ts';

export class JevDecisionLog {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private rows = new Map<string, { element: HTMLDivElement; summary: HTMLDivElement; exact: HTMLPreElement; details: HTMLDetailsElement; provider: HTMLPreElement; fetched: Set<string>; providerRecords: unknown[] }>();
  private revision = -1;
  constructor(stage: HTMLElement, privateSession: JevSession) {
    this.root = document.createElement('div'); this.root.className = 'jev-log'; this.root.hidden = true;
    const header = document.createElement('div'); header.className = 'jev-log-header';
    const title = document.createElement('strong'); title.textContent = 'Jev decisions'; header.appendChild(title);
    const exportButton = document.createElement('button'); exportButton.textContent = 'Export browser history';
    exportButton.onclick = () => void privateSession.exportDecisionLog().then(records => {
      const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'spectre-jev-browser-history.json'; link.click(); URL.revokeObjectURL(url);
    }); header.appendChild(exportButton);
    const serverLink = document.createElement('a'); serverLink.href = '/api/jev/history/export'; serverLink.textContent = 'Export exact provider history'; serverLink.target = '_blank'; header.appendChild(serverLink);
    const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => this.toggle(false); header.appendChild(close);
    const note = document.createElement('p'); note.textContent = 'Latest 20 batches. Summaries describe selected actions, not model reasoning. Expand exact browser inputs/results; provider history includes the exact upstream questions.';
    this.body = document.createElement('div'); this.body.className = 'jev-log-body'; this.root.append(header, note, this.body); stage.appendChild(this.root);
  }
  toggle(on = this.root.hidden): void { this.root.hidden = !on; }
  update(session: JevSession): void {
    const revision = session.getAuditRevision(); if (revision === this.revision) return; this.revision = revision;
    const records = session.getDecisionLog().slice(-20).reverse(), keep = new Set(records.map(r => r.id));
    for (const [id, row] of this.rows) if (!keep.has(id)) { row.element.remove(); this.rows.delete(id); }
    if (records.length && !this.rows.size) this.body.replaceChildren();
    for (const record of records) {
      let row = this.rows.get(record.id);
      if (!row) {
        const element = document.createElement('div'); element.className = 'jev-log-row'; element.dataset.auditId = record.id;
        const summary = document.createElement('div');
        const details = document.createElement('details'); const label = document.createElement('summary'); label.textContent = 'Exact inputs, candidates and result';
        const exact = document.createElement('pre');
        const browserLabel = document.createElement('strong'); browserLabel.textContent = 'Exact browser request / response';
        const providerLabel = document.createElement('strong'); providerLabel.textContent = 'Exact provider inputs / outputs (loaded on expansion)';
        const provider = document.createElement('pre'); provider.textContent = 'No linked provider calls yet.';
        details.append(label, browserLabel, exact, providerLabel, provider); element.append(summary, details);
        row = { element, summary, exact, details, provider, fetched: new Set(), providerRecords: [] }; this.rows.set(record.id, row);
        details.addEventListener('toggle', () => this.loadProvider(record.id, session));
      }
      row.summary.textContent = summarize(record);
      row.exact.textContent = JSON.stringify({ request: record.request, response: record.response ?? null, decisions: record.decisions, outcome: record.outcome, error: record.error ?? null }, null, 2);
      if (row.details.open) this.loadProvider(record.id, session, record);
      this.body.appendChild(row.element); // Existing details node keeps its expansion state.
    }
    if (!records.length) this.body.textContent = 'No Jev requests yet. Enable Jev AI during single-player gameplay.';
  }
  private loadProvider(id: string, session: JevSession, current?: DecisionAudit): void {
    const row = this.rows.get(id); if (!row?.details.open) return;
    const record = current ?? session.getDecisionLog().find(r => r.id === id);
    for (const decision of record?.decisions ?? []) {
      const callId = decision.callId; if (!callId || row.fetched.has(callId)) continue;
      row.fetched.add(callId); row.provider.textContent = 'Loading exact provider history…';
      void fetch(`/api/jev/history?callId=${encodeURIComponent(callId)}&limit=10`).then(async response => {
        if (!response.ok) throw new Error(`History ${response.status}`);
        const history = await response.json() as { records: unknown[] };
        row.providerRecords.push(...history.records);
        row.provider.textContent = JSON.stringify(row.providerRecords, null, 2);
      }).catch(() => { row.provider.textContent = 'Provider history unavailable. The exact browser request and response remain above; export server history when the backend is available.'; });
    }
  }
}
function summarize(record: DecisionAudit): string {
  const head = `${record.at.slice(11, 23)} UTC · Level ${record.level} · game ${(record.tick * SIM_DT).toFixed(2)}s / tick ${record.tick} · batch ${record.sequence} · ${record.outcome}${record.latencyMs === undefined ? '' : ` · ${Math.round(record.latencyMs)} ms`}`;
  const request = record.request as { tanks?: { tankId: string; observation: TankObservation }[] };
  const lines = record.decisions.map(d => {
    const observation = request.tanks?.find(t => t.tankId === d.tankId)?.observation;
    const sightings = [...(observation?.contacts ?? []), ...(observation?.memory ?? [])].filter(c => c.kind === 'tank').slice(0, 2).map(c => {
      const seen = c.seenSeconds ?? c.seenTick * SIM_DT;
      const age = c.ageSeconds ?? Math.max(0, record.tick * SIM_DT - seen);
      return `${c.id} ${c.source ?? 'own'} sighting at ${seen.toFixed(2)}s; age ${age.toFixed(2)}s at decision; position (${c.position.x.toFixed(1)}, ${c.position.z.toFixed(1)}); heading ${c.heading === undefined ? 'unknown' : Math.round(c.heading * 180 / Math.PI) + '°'}`;
    });
    return `${d.role} ${d.tankId}: ${d.strategy ?? d.choice.split(':')[0]} — ${d.description}${d.confidence === undefined ? '' : ` · confidence ${(d.confidence * 100).toFixed(1)}%`} [${d.applied ? `applied at tick ${d.appliedTick}` : d.accepted ? d.notAppliedReason ? `accepted; not executed (${d.notAppliedReason})` : 'accepted; awaiting execution' : 'discarded'}]` + (sightings.length ? '\n  ' + sightings.join('\n  ') : '\n  No tank sighting in this captured observation.');
  });
  return head + '\n' + (lines.length ? lines.join('\n') : record.error ?? 'Waiting for model response.');
}
