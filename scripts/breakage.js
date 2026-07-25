import { serialize } from "./utils.js";

const MODULE_ID = "hstl-crystal";

/**
 * Keyed by Foundry User id (not Actor id) — a broken crystal is the
 * physical device itself, not tied to whichever character its owner
 * happens to be posting as. { [userId]: true } for broken, absent for
 * working normally.
 */
export function getBrokenCrystals() {
  return game.settings.get(MODULE_ID, "brokenCrystals") ?? {};
}

export function setCrystalBroken(userId, broken) {
  return serialize(async () => {
    const current = getBrokenCrystals();
    const next = { ...current };
    if (broken) {
      next[userId] = true;
    } else {
      delete next[userId];
    }
    await game.settings.set(MODULE_ID, "brokenCrystals", next);
  });
}
