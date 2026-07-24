const MODULE_ID = "hstl-crystal";

export function getJobs() {
  return game.settings.get(MODULE_ID, "jobs") ?? [];
}

export async function writeJobs(jobs) {
  await game.settings.set(MODULE_ID, "jobs", jobs);
}

/**
 * Applies an arbitrary field update to one job. Used for GM edits like
 * marking complete or reopening, where there's no race to guard against
 * since only the GM calls this.
 */
export async function writeJobUpdate(jobId, changes) {
  const jobs = getJobs();
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) return null;
  jobs[idx] = { ...jobs[idx], ...changes };
  await writeJobs(jobs);
  return jobs[idx];
}

/**
 * Claims a job, but only if it's still open at the moment this actually
 * runs on the GM's client. Guards against two players accepting the same
 * listing moments apart.
 */
export async function acceptJobIfOpen(jobId, claimantName) {
  const jobs = getJobs();
  const idx = jobs.findIndex(j => j.id === jobId);
  if (idx === -1) return { ok: false, reason: "not-found" };
  if (jobs[idx].status !== "open") return { ok: false, reason: "not-open" };
  jobs[idx] = { ...jobs[idx], status: "claimed", claimedBy: claimantName };
  await writeJobs(jobs);
  return { ok: true, job: jobs[idx] };
}

/**
 * GM edits (mark complete, reopen, etc.) write directly. Player accepts
 * relay through the socket the same way Scry posts do, since world
 * settings can only be persisted by the GM's client.
 */
export function submitJobUpdate(jobId, changes) {
  if (game.user.isGM) {
    return writeJobUpdate(jobId, changes);
  }
  game.socket.emit(`module.${MODULE_ID}`, { type: "updateJob", jobId, changes });
  return Promise.resolve(null);
}

export function submitAcceptJob(jobId, claimantName) {
  if (game.user.isGM) {
    return acceptJobIfOpen(jobId, claimantName);
  }
  game.socket.emit(`module.${MODULE_ID}`, { type: "acceptJob", jobId, claimantName });
  return Promise.resolve({ ok: true, optimistic: true });
}
