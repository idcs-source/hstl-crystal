import { serialize } from "./utils.js";

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
 * threads: { [pairKey]: [message, ...] } — one shared thread per pair
 * of participants, keyed by both Actor ids sorted together so it reads
 * the same regardless of which side it's opened from. Each message
 * carries senderId (an Actor id) rather than a relative "self"/"contact"
 * label, so which side a bubble renders on is computed fresh from
 * whoever's currently viewing it, not baked in at write time.
 */
function pairKey(idA, idB) {
  return [idA, idB].sort().join("::");
}

export function getTexting() {
  return game.settings.get(MODULE_ID, "texting") ?? { grants: {}, threads: {} };
}

async function writeTexting(changes) {
  const current = getTexting();
  const next = { ...current, ...changes };
  await game.settings.set(MODULE_ID, "texting", next);
  return next;
}

export function getGrantedContacts(crystalId) {
  return getTexting().grants?.[crystalId] ?? [];
}

/**
 * GM-only in practice — only the Texting Manager ever calls this.
 * Wrapped in serialize() so toggling a grant can never race a message
 * being appended to that same crystal's threads at the same time.
 */
export function setGrantedContacts(crystalId, contactIds) {
  return serialize(async () => {
    const texting = getTexting();
    const grants = { ...(texting.grants ?? {}) };
    grants[crystalId] = contactIds;
    await writeTexting({ grants });
  });
}

export function getThread(crystalId, contactId) {
  return getTexting().threads?.[pairKey(crystalId, contactId)] ?? [];
}

/**
 * senderId is whoever actually sent the message — the crystal being
 * viewed, when sent from the phone, or the contact being puppeted,
 * when sent from the Texting Manager. otherPartyId is whoever's on the
 * other end of this specific conversation. Wrapped in serialize() so
 * the phone and the Texting Manager sending close together can't race.
 *
 * Sending a message also grants each side visibility of the other, in
 * both directions, if that grant doesn't already exist. Grants are
 * still one-directional in storage (a crystal can see a contact
 * without that contact automatically seeing it back), which matters
 * for setting up a message before a player has any access at all — but
 * the moment an actual conversation exists between two crystals a
 * player *can* already reach, both sides should be able to find and
 * reply to it without the GM needing to remember to check the box on
 * both ends separately.
 */
export function appendMessage(senderId, otherPartyId, text) {
  return serialize(async () => {
    const texting = getTexting();

    const threads = { ...(texting.threads ?? {}) };
    const key = pairKey(senderId, otherPartyId);
    const thread = [...(threads[key] ?? [])];
    thread.push({
      id: foundry.utils.randomID(8),
      senderId,
      text,
      timestamp: Date.now()
    });
    threads[key] = thread;

    const grants = { ...(texting.grants ?? {}) };
    if (!(grants[senderId] ?? []).includes(otherPartyId)) {
      grants[senderId] = [...(grants[senderId] ?? []), otherPartyId];
    }
    if (!(grants[otherPartyId] ?? []).includes(senderId)) {
      grants[otherPartyId] = [...(grants[otherPartyId] ?? []), senderId];
    }

    await writeTexting({ threads, grants });
  });
}

/** GM-only. Exposed from both the phone and the Texting Manager. */
export function deleteMessage(crystalId, contactId, messageId) {
  return serialize(async () => {
    const texting = getTexting();
    const threads = { ...(texting.threads ?? {}) };
    const key = pairKey(crystalId, contactId);
    threads[key] = (threads[key] ?? []).filter(m => m.id !== messageId);
    await writeTexting({ threads });
  });
}

/**
 * Player-facing send from the phone — always sent as whoever holds the
 * crystal being viewed. Relays to the GM the same way Scry posts do,
 * since only the GM's client can persist a world setting write.
 */
export function submitTextMessage(crystalId, contactId, text) {
  if (game.user.isGM) {
    return appendMessage(crystalId, contactId, text);
  }
  game.socket.emit(`module.${MODULE_ID}`, { type: "sendText", crystalId, contactId, text });
  return Promise.resolve();
}
