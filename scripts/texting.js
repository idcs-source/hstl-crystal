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
 *
 * reads: { [pairKey]: { [viewerKey]: timestamp } } — the last time a
 * given viewer actually looked at that thread. viewerKey is either an
 * Actor id (whichever crystal someone's viewing the thread as, GM or
 * player) or the literal string "__gm__" for the GM's own Needs Reply
 * tracking, which isn't tied to any single Actor since the GM can
 * reply as a different contact in the same thread from one message to
 * the next. Two independent viewers of the same thread — you replying
 * as an NPC, a player reading it as their own crystal — never share a
 * read marker, so one of you catching up doesn't silently mark it read
 * for the other.
 */
function pairKey(idA, idB) {
  return [idA, idB].sort().join("::");
}

export function getTexting() {
  return game.settings.get(MODULE_ID, "texting") ?? { grants: {}, threads: {}, reads: {} };
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
 * Marks a thread as caught-up as of right now, for one specific viewer.
 * viewerKey defaults to "__gm__" for the GM's own Needs Reply tracking;
 * pass an Actor id when marking read on behalf of whichever crystal is
 * actually being viewed (the phone always does this).
 */
export function markThreadRead(crystalId, contactId, viewerKey = "__gm__") {
  return serialize(async () => {
    const texting = getTexting();
    const reads = { ...(texting.reads ?? {}) };
    const key = pairKey(crystalId, contactId);
    reads[key] = { ...(reads[key] ?? {}), [viewerKey]: Date.now() };
    await writeTexting({ reads });
  });
}

/**
 * Every thread with at least one message newer than the GM last looked
 * at it, newest activity first. This is what powers both the Needs
 * Reply list and the badge count on the Contacts icon — with 30+
 * actors, paging through every crystal individually to find where a
 * player actually said something isn't workable, this is the fix for
 * that.
 */
export function getUnreadThreads() {
  const texting = getTexting();
  const threads = texting.threads ?? {};
  const reads = texting.reads ?? {};
  const results = [];

  for (const [key, messages] of Object.entries(threads)) {
    if (!messages || messages.length === 0) continue;
    const lastRead = reads[key]?.["__gm__"] ?? 0;
    const unreadCount = messages.filter(m => m.timestamp > lastRead).length;
    if (unreadCount === 0) continue;

    const [idA, idB] = key.split("::");
    const lastMessage = messages[messages.length - 1];
    results.push({
      crystalId: idA,
      contactId: idB,
      unreadCount,
      lastTimestamp: lastMessage.timestamp,
      lastSenderId: lastMessage.senderId
    });
  }

  return results.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
}

/**
 * Per-contact unread counts for one specific crystal — { contactId:
 * count, ... } — powers the badge on a player's Texts icon and the
 * per-contact badges in their inbox list. A message the crystal itself
 * sent never counts as unread for it, only messages from the other
 * side of the conversation do.
 */
export function getUnreadForCrystal(crystalId) {
  const texting = getTexting();
  const threads = texting.threads ?? {};
  const reads = texting.reads ?? {};
  const result = {};

  for (const [key, messages] of Object.entries(threads)) {
    if (!messages || messages.length === 0) continue;
    const [idA, idB] = key.split("::");
    if (idA !== crystalId && idB !== crystalId) continue;
    const contactId = idA === crystalId ? idB : idA;

    const lastRead = reads[key]?.[crystalId] ?? 0;
    const unreadCount = messages.filter(m => m.timestamp > lastRead && m.senderId !== crystalId).length;
    if (unreadCount > 0) result[contactId] = unreadCount;
  }

  return result;
}

/**
 * Player-facing version of markThreadRead — relays to the GM the same
 * way every other player-originated write does, since a direct
 * game.settings.set() call would silently fail for a non-GM client.
 */
export function submitMarkThreadRead(crystalId, contactId, viewerKey) {
  if (game.user.isGM) {
    return markThreadRead(crystalId, contactId, viewerKey);
  }
  game.socket.emit(`module.${MODULE_ID}`, { type: "markThreadRead", crystalId, contactId, viewerKey });
  return Promise.resolve();
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

/**
 * Parses a pasted script into an ordered list of messages. Expected
 * format, one message per line:
 *   Crystal: message text
 *   Contact: message text
 * Blank lines, headers, or anything else that doesn't start with one
 * of those two labels is skipped, so a script with day headers or
 * blank lines between exchanges can be pasted in as-is without needing
 * to be cleaned up by hand first.
 */
function parseImportScript(raw) {
  const parsed = [];
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*(crystal|contact)\s*:\s*(.+)$/i);
    if (!match) continue;
    const text = match[2].trim();
    if (!text) continue;
    parsed.push({ sender: match[1].toLowerCase() === "crystal" ? "self" : "contact", text });
  }
  return parsed;
}

/**
 * Spreads `count` timestamps across the last `spreadDays` days, ending
 * at "now", in increasing order with a little jitter so a long
 * imported history doesn't look mechanically evenly-spaced. spreadDays
 * of 0 (or omitted) just stamps everything with the current time.
 */
function generateSpreadTimestamps(count, spreadDays) {
  const now = Date.now();
  if (!spreadDays || spreadDays <= 0 || count <= 1) {
    return new Array(count).fill(now);
  }
  const totalMs = spreadDays * 24 * 60 * 60 * 1000;
  const start = now - totalMs;
  const stamps = [];
  for (let i = 0; i < count; i++) {
    const base = start + (totalMs * i) / (count - 1);
    const jitter = (Math.random() - 0.5) * (totalMs / count) * 0.5;
    stamps.push(Math.round(Math.min(now, Math.max(start, base + jitter))));
  }
  return stamps.sort((a, b) => a - b);
}

/**
 * Bulk-imports a whole conversation in one shot instead of sending each
 * line through the composer individually. GM-only, called from the
 * Texting Manager. Appends onto the existing thread by default;
 * `replace: true` clears it first. Auto-grants both directions the
 * same way a normal appendMessage does, so the conversation is visible
 * immediately once a player actually gets access to that crystal.
 */
export function importConversation(crystalId, contactId, rawScript, { spreadDays = 0, replace = false } = {}) {
  return serialize(async () => {
    const parsed = parseImportScript(rawScript);
    if (parsed.length === 0) return { count: 0 };

    const timestamps = generateSpreadTimestamps(parsed.length, spreadDays);

    const texting = getTexting();
    const threads = { ...(texting.threads ?? {}) };
    const key = pairKey(crystalId, contactId);
    const existing = replace ? [] : [...(threads[key] ?? [])];

    const newMessages = parsed.map((m, i) => ({
      id: foundry.utils.randomID(8),
      senderId: m.sender === "self" ? crystalId : contactId,
      text: m.text,
      timestamp: timestamps[i]
    }));

    threads[key] = [...existing, ...newMessages];

    const grants = { ...(texting.grants ?? {}) };
    if (!(grants[crystalId] ?? []).includes(contactId)) {
      grants[crystalId] = [...(grants[crystalId] ?? []), contactId];
    }
    if (!(grants[contactId] ?? []).includes(crystalId)) {
      grants[contactId] = [...(grants[contactId] ?? []), crystalId];
    }

    await writeTexting({ threads, grants });
    return { count: newMessages.length };
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
  console.log(`[HSTL] submitTextMessage — isGM=${game.user.isGM}, user=${game.user.name}, crystalId=${crystalId}, contactId=${contactId}`);
  if (game.user.isGM) {
    return appendMessage(crystalId, contactId, text);
  }
  game.socket.emit(`module.${MODULE_ID}`, { type: "sendText", crystalId, contactId, text });
  console.log("[HSTL] submitTextMessage — relayed over socket to GM");
  return Promise.resolve();
}
