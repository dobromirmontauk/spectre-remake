import { SIM_DT } from '../config/constants.ts';
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
  const head = `${record.at.slice(11, 23)} UTC · L${record.level} · game ${(record.tick * SIM_DT).toFixed(2)}s · ${record.outcome}${record.latencyMs === undefined ? '' : ` · ${Math.round(record.latencyMs)} ms`}`;
  const lines = record.decisions.map(d => {
    const action = d.description.split(';')[0]!.replace(/^Strategy \w+:\s*/, '').replace(/\s+at\s*\d+-unit radius|\s+from a\s*\d+-unit stand-off vantage/g, '');
    const shortAction = action.length > 60 ? action.slice(0, 57) + '…' : action;
    const execution = d.applied ? 'applied' : d.accepted ? d.notAppliedReason ? `not executed: ${d.notAppliedReason}` : 'accepted' : 'discarded';
    return `${d.tankId} · ${d.strategy ?? d.choice.split(':')[0]} · ${shortAction}${d.confidence === undefined ? '' : ` · ${(d.confidence * 100).toFixed(0)}%`} · ${execution}`;
  });
  return head + '\n' + (lines.length ? lines.join('\n') : record.error ?? 'Waiting for model response.');
}
