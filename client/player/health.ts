import { OxPlayer } from 'player';

// Server-side GetEntityHealth is unreliable for player peds in rdr3, so the client replicates
// its live health through a statebag. The server reads it only on save (no per-tick events),
// which scales to high player counts. Mirrors how `isDead` is handled.
//
// The check runs every 250ms but only ever hits the network when the value changes (idle
// players cost nothing) — the short interval just shrinks the window where a disconnect right
// after taking damage could save stale (too-high) health, since the statebag update has to
// reach the server before logout reads it.
on('ox:playerLoaded', () => {
  let lastHealth: number | undefined;

  const id: CitizenTimer = setInterval(() => {
    if (!OxPlayer.isLoaded) return clearInterval(id);

    const ped = PlayerPedId();
    if (IsEntityDead(ped)) return;

    const health = GetEntityHealth(ped);
    if (health === lastHealth) return;

    lastHealth = health;
    LocalPlayer.state.set('health', health, true);
  }, 250);
});
