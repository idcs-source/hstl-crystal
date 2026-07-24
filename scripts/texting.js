const MODULE_ID = "hstl-crystal";

/**
 * A "crystal" here is just whichever Actor a message thread belongs to —
 * there's no separate crystal document, ownership of that Actor (normal
 * Foundry permissions) is what makes it show up for a given player at
 * all. A "contact" is likewise just another Actor's id; there's no
 * separate contact record beyond that, a contact's name always comes
 * live from the Actor it points to.
 *
 * grants: { [crystalActorId]: [contactActorId, ...] } — which contacts
 * are visible on a given crystal. GM-only to edit, via the Texting
 * Manager.
 *
 * threads: { [crystalActorId]: { [contactActorId]: [message, ...] } } —
 * the actual conversation, keyed the same way so each crystal/contact
 * pair has its own independent history.
 */
export function getTexting() {
  return game.settings.get(MODULE_ID, "texting") ?? { grants: {}, threads: {} };
}

export async function writeTexting(changes) {
  const current = getTexting();
  const next = { ...current, ...changes };
  await game.settings.set(MODULE_ID, "texting", next);
  return next;
}

export function getGrantedContacts(crystalId) {
  return getTexting().grants?.[crystalId] ?? [];
}

/** GM-only in practice — only the Texting Manager ever calls this. */
export async function setGrantedContacts(crystalId, contactIds) {
  const texting = getTexting();
  const grants = { ...(texting.grants ?? {}) };
  grants[crystalId] = contactIds;
  await writeTexting({ grants });
}

export function getThread(crystalId, contactId) {
  return getTexting().threads?.[crystalId]?.[contactId] ?? [];
}

/**
 * Appends one message. sender is "self" for a message from whoever
 * currently holds the crystal (a player, or the GM using the phone
 * directly), or "contact" for a message the GM sends as that contact
 * through the Texting Manager — that's the only distinction that
 * decides which side of the thread a bubble renders on.
 */
export async function appendMessage(crystalId, contactId, sender, text) {
  const texting = getTexting();
  const threads = { ...(texting.threads ?? {}) };
  const crystalThreads = { ...(threads[crystalId] ?? {}) };
  const thread = [...(crystalThreads[contactId] ?? [])];
  thread.push({
    id: foundry.utils.randomID(8),
    sender,
    text,
    timestamp: Date.now()
  });
  crystalThreads[contactId] = thread;
  threads[crystalId] = crystalThreads;
  await writeTexting({ threads });
}

/**
 * Player-facing send, always sender "self". Relays to the GM the same
 * way Scry posts do, since only the GM's client can persist a world
 * setting write.
 */
export function submitTextMessage(crystalId, contactId, text) {
  if (game.user.isGM) {
    return appendMessage(crystalId, contactId, "self", text);
  }
  game.socket.emit(`module.${MODULE_ID}`, { type: "sendText", crystalId, contactId, text });
  return Promise.resolve();
}
