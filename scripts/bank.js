import { serialize } from "./utils.js";

const MODULE_ID = "hstl-crystal";

/**
 * Everything is stored as a single integer count of silver pieces per
 * field (10sp = 1gp), never as separate gold/silver numbers. That's
 * what makes "add 150g 5s, subtract 3g 8s" trivial and rounding-proof —
 * it's just integer addition on one number, with gold/silver only ever
 * split back out for display or combined back in from form inputs.
 */
export function getBank() {
  return game.settings.get(MODULE_ID, "bank") ?? {
    goldSilver: 0,
    debtTotalSilver: 0,
    debtPaidSilver: 0
  };
}

export function writeBank(changes) {
  return serialize(async () => {
    const current = getBank();
    const next = { ...current, ...changes };
    await game.settings.set(MODULE_ID, "bank", next);
    return next;
  });
}

/**
 * Reads and writes a single field in one atomic step — this is what the
 * Banking adjuster buttons call. Keeping the read inside the same
 * serialize() turn as the write is what actually matters here: doing
 * the read in the caller and only the write in here would still leave
 * a gap for another write to land in between.
 */
export function adjustBankField(field, mode, deltaSilver) {
  return serialize(async () => {
    const current = getBank();
    let next = current[field] ?? 0;
    if (mode === "add") next += deltaSilver;
    else if (mode === "subtract") next -= deltaSilver;
    else if (mode === "set") next = deltaSilver;
    next = Math.max(0, next);
    await game.settings.set(MODULE_ID, "bank", { ...current, [field]: next });
    return next;
  });
}

/**
 * No player-facing control ever calls this today — editing is GM-only —
 * but it's written relay-safe the same way every other write in this
 * module is, so it isn't a trap if a player-facing entry point gets
 * added later.
 */
export function submitBankUpdate(changes) {
  if (game.user.isGM) {
    return writeBank(changes);
  }
  game.socket.emit(`module.${MODULE_ID}`, { type: "updateBank", changes });
  return Promise.resolve(null);
}

export function partsToSilver(gold, silver) {
  return (Number(gold) || 0) * 10 + (Number(silver) || 0);
}

export function silverToParts(totalSilver) {
  const value = Math.max(0, Number(totalSilver) || 0);
  return { gold: Math.floor(value / 10), silver: value % 10 };
}

export function formatGoldSilver(totalSilver) {
  const { gold, silver } = silverToParts(totalSilver);
  return `${gold.toLocaleString()}g ${silver}s`;
}
