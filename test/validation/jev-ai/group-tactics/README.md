# Actual logged group combat replay

Open `replay.html` through a local HTTP server rooted at the repository. No CDN, model calls or generated decisions. Browser `DecompressionStream` reads the existing gzip inputs by relative URL; archives are reused, not copied.

Inputs: `../2026-09-30/level5/{samples,actions,decisions}.json.gz`. Original gameplay source SHA: **84d64cc**. This is the actual Level 5 validation trace, restricted to its first **48 simulation seconds** for the combat excerpt. Snapshot state interpolates tank position and heading between adjacent snapshots; death/respawn discontinuities do not interpolate. Flags, projectiles, geometry and health come from the preceding logged snapshot. Thus projectile flight can visibly step at sample boundaries; this viewer does not resimulate or invent missing shot states. Trails show sampled motion over 1.5 seconds. The deterministic focus camera averages nearby group bounding boxes over a short time window; inset always shows the full arena.

Action labels come from the most recent tick-stamped executed action per tank, including local fallback. Commander panels use the last logged request at or before the replay tick, and source/age of its opposing tank contacts. A selected description is shown only when its decision matches the executed plan ID. Panels do not imply that full observer scene state was supplied to any commander. Personality is the actual request field. There are no pincer, cooperation, or strategic-intent claims added by the viewer.

Resolution: 1440×900 viewport (1030×750 main canvas plus panels). Lead should visually inspect and choose annotations based on observed behavior, then capture the browser as a video. Browser automation API:

```js
await page.waitForFunction(() => window.__replay?.ready);
await page.evaluate(() => window.__replay.setTime(12.0));
// __replay.duration === 48; setTime pauses playback for deterministic frame capture.
```

The controls offer pause, seek and playback speed. This artifact is an observer replay, not a live provider benchmark or proof of coordinated tactics. Full input logs remain the ground truth. Code edits here do not alter gameplay, controller decisions or the backend.
