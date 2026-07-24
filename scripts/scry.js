import { serialize } from "./utils.js";

const MODULE_ID = "hstl-crystal";

/** Reads the current Scry feed from the world setting. */
export function getScryPosts() {
  return game.settings.get(MODULE_ID, "scryPosts") ?? [];
}

/**
 * Writes a post directly to the world setting. Only succeeds for a GM
 * client, since world-scoped settings can only be persisted by the GM.
 * Non-GM callers should use submitScryPost instead. Wrapped in
 * serialize() along with every other write below, so a like landing at
 * the same moment as a new post can't silently erase one or the other.
 */
export function writeScryPost(post) {
  return serialize(async () => {
    const posts = getScryPosts();
    posts.push(post);
    await game.settings.set(MODULE_ID, "scryPosts", posts);
  });
}

/**
 * Submits a new post. If the calling client is the GM, writes directly.
 * Otherwise, relays the post over the socket to the GM's client, which
 * performs the actual write on the player's behalf. Either path results
 * in the same world setting update, which every client picks up via the
 * core "updateSetting" hook.
 *
 * likes/dislikes are keyed by reactor identity (see applyReaction) so a
 * page reload doesn't lose who's already reacted. phantomLikes and
 * phantomDislikes are the GM's unlimited, unattributed bulk reactions.
 * replies is a flat array of lightweight reply objects on the post.
 */
export function submitScryPost({ actorId, actorName, actorImg, text, imagePath }) {
  const post = {
    id: foundry.utils.randomID(8),
    actorId: actorId ?? null,
    actorName,
    actorImg,
    text,
    imagePath: imagePath ?? null,
    timestamp: Date.now(),
    likes: {},
    dislikes: {},
    phantomLikes: 0,
    phantomDislikes: 0,
    replies: []
  };

  console.log(`[HSTL] submitScryPost — isGM=${game.user.isGM}, user=${game.user.name}`, post);

  if (game.user.isGM) {
    return writeScryPost(post);
  }

  game.socket.emit(`module.${MODULE_ID}`, { type: "createScryPost", post });
  console.log("[HSTL] submitScryPost — relayed over socket to GM");
  return Promise.resolve();
}

/**
 * Deletes a post by id. GM-only by design (no player-facing delete
 * action exists), so this always writes directly.
 */
export function deleteScryPost(postId) {
  return serialize(async () => {
    const posts = getScryPosts().filter(p => p.id !== postId);
    await game.settings.set(MODULE_ID, "scryPosts", posts);
  });
}

/**
 * Toggles a named reaction for one identity (a player's assigned
 * character, or their Foundry user id if they have none). Reacting one
 * way clears any existing reaction the other way from the same
 * identity, and reacting the same way twice removes it — a normal
 * toggle.
 */
export function applyReaction(postId, kind, reactorKey, reactorName) {
  return serialize(async () => {
    const posts = getScryPosts();
    const idx = posts.findIndex(p => p.id === postId);
    if (idx === -1) return;

    const post = {
      ...posts[idx],
      likes: { ...(posts[idx].likes ?? {}) },
      dislikes: { ...(posts[idx].dislikes ?? {}) }
    };
    const target = kind === "like" ? "likes" : "dislikes";
    const opposite = kind === "like" ? "dislikes" : "likes";

    if (post[target][reactorKey]) {
      delete post[target][reactorKey];
    } else {
      post[target][reactorKey] = reactorName;
      delete post[opposite][reactorKey];
    }

    posts[idx] = post;
    await game.settings.set(MODULE_ID, "scryPosts", posts);
  });
}

export function submitReaction(postId, kind, reactorKey, reactorName) {
  console.log(`[HSTL] submitReaction — isGM=${game.user.isGM}, user=${game.user.name}, kind=${kind}`);
  if (game.user.isGM) {
    return applyReaction(postId, kind, reactorKey, reactorName);
  }
  game.socket.emit(`module.${MODULE_ID}`, { type: "reactToPost", postId, kind, reactorKey, reactorName });
  console.log("[HSTL] submitReaction — relayed over socket to GM");
  return Promise.resolve();
}

/**
 * GM-only, stacks without limit and isn't tied to any single identity —
 * this is the "and 2000 others" flourish. Always GM-direct, since only
 * the GM's client ever exposes the control that calls it. Delta can be
 * negative to walk an overshoot back down; clamped at 0.
 */
export function adjustPhantomReaction(postId, kind, delta) {
  return serialize(async () => {
    const posts = getScryPosts();
    const idx = posts.findIndex(p => p.id === postId);
    if (idx === -1) return;
    const field = kind === "like" ? "phantomLikes" : "phantomDislikes";
    const current = posts[idx][field] ?? 0;
    posts[idx] = { ...posts[idx], [field]: Math.max(0, current + delta) };
    await game.settings.set(MODULE_ID, "scryPosts", posts);
  });
}

export function appendReply(postId, reply) {
  return serialize(async () => {
    const posts = getScryPosts();
    const idx = posts.findIndex(p => p.id === postId);
    if (idx === -1) return;
    const replies = [...(posts[idx].replies ?? []), reply];
    posts[idx] = { ...posts[idx], replies };
    await game.settings.set(MODULE_ID, "scryPosts", posts);
  });
}

/** GM-only, no player-facing delete action exists for replies either. */
export function deleteReply(postId, replyId) {
  return serialize(async () => {
    const posts = getScryPosts();
    const idx = posts.findIndex(p => p.id === postId);
    if (idx === -1) return;
    const replies = (posts[idx].replies ?? []).filter(r => r.id !== replyId);
    posts[idx] = { ...posts[idx], replies };
    await game.settings.set(MODULE_ID, "scryPosts", posts);
  });
}

export function submitReply(postId, { actorId, actorName, actorImg, text }) {
  const reply = {
    id: foundry.utils.randomID(8),
    actorId: actorId ?? null,
    actorName,
    actorImg,
    text,
    timestamp: Date.now()
  };

  if (game.user.isGM) {
    return appendReply(postId, reply);
  }
  console.log(`[HSTL] submitReply — isGM=${game.user.isGM}, user=${game.user.name} — relaying to GM`);
  game.socket.emit(`module.${MODULE_ID}`, { type: "replyToPost", postId, reply });
  return Promise.resolve();
}
