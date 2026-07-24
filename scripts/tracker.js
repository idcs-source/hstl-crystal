const MODULE_ID = "hstl-crystal";

/** Five fresh, unmarked slots — the shape every activation resets to. */
export function freshSlots() {
  return ["pending", "pending", "pending", "pending", "pending"];
}

export function getTracker() {
  return game.settings.get(MODULE_ID, "activeTracker") ?? {
    active: false,
    jobId: null,
    label: "",
    slots: freshSlots()
  };
}

export async function writeTracker(changes) {
  const current = getTracker();
  const next = { ...current, ...changes };
  await game.settings.set(MODULE_ID, "activeTracker", next);
  return next;
}

/**
 * Only the GM ever calls this — the control panel that exposes it is a
 * GM-only window — but it's written GM-direct/relay-safe the same way
 * jobs.js is, so a future player-facing entry point wouldn't need
 * rewriting to be safe.
 */
export function submitTrackerUpdate(changes) {
  if (game.user.isGM) {
    return writeTracker(changes);
  }
  game.socket.emit(`module.${MODULE_ID}`, { type: "updateTracker", changes });
  return Promise.resolve(null);
}
