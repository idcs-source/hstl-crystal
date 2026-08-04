import { serialize } from "./utils.js";

const MODULE_ID = "hstl-crystal";
const SCRY_STORE_FLAG = "isScryStore";
const SCRY_JOURNAL_NAME = "HSTL Crystal — Scry Data (auto-managed, safe to ignore)";

/**
 * Scry posts live on a dedicated JournalEntry's flags rather than a
 * game.settings world setting, which is a deliberate departure from
 * how every other part of this module stores its data. World settings
 * can only ever be persisted by a user with the Assistant GM / GM
 * "Modify Configuration Settings" permission — that's a hard rule
 * enforced by Foundry itself, not something a module can configure
 * around. Document ownership, by contrast, is assignable to any user,
 * so granting every player Owner permission on this one journal lets
 * them post to Scry any time they're personally connected, without
 * needing the GM (or anyone else) online too — which is the entire
 * point, given the GM isn't always around but the world itself is.
 *
 * The tradeoff: writes now come directly from whichever player's own
 * client is posting, rather than funneling through one shared queue on
 * the GM's client the way everything else in this module still does.
 * Two people posting in the exact same instant could in principle
 * race and one post could get lost — serialize() still protects a
 * single client's own rapid actions against itself, but it can't
 * coordinate across two entirely separate browsers the way the old
 * GM-relay model incidentally did. That's judged an acceptable, narrow
 * risk for how Scry actually gets used, occasional posts rather than
 * rapid-fire chat, not something worth building real conflict
 * resolution for.
 */
function findScryJournal() {
  return game.journal?.find(j => j.getFlag(MODULE_ID, SCRY_STORE_FLAG) === true) ?? null;
}

/**
 * GM-only, run once automatically when the world loads. Safe to call
 * repeatedly — it's a no-op once the journal already exists, so it
 * never wipes existing posts on a later reload.
 */
export async function ensureScryJournal() {
  if (!game.user.isGM) return null;
  const existing = findScryJournal();
  if (existing) return existing;

  // Carries over anything already sitting in the old game.settings
  // storage — this only ever runs once, the moment before the journal
  // exists yet, so it can't clobber real posts on a later reload.
  const legacyPosts = game.settings.get(MODULE_ID, "scryPosts") ?? [];

  const journal = await JournalEntry.create({
    name: SCRY_JOURNAL_NAME,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    flags: {
      [MODULE_ID]: {
        [SCRY_STORE_FLAG]: true,
        posts: legacyPosts
      }
    }
  });
  console.log(`HSTL Crystal | Created the Scry data journal (migrated ${legacyPosts.length} existing post${legacyPosts.length === 1 ? "" : "s"}) — every player has Owner permission on it so they can post without the GM needing to be online.`);
  return journal;
}

export function getScryPosts() {
  return findScryJournal()?.getFlag(MODULE_ID, "posts") ?? [];
}

async function writeScryPosts(posts) {
  const journal = findScryJournal();
  if (!journal) {
    ui.notifications?.error("HSTL Crystal: the Scry data journal is missing. Ask your GM to reopen the world so it can be recreated.");
    return;
  }
  await journal.setFlag(MODULE_ID, "posts", posts);
}

export function writeScryPost(post) {
  return serialize(async () => {
    const posts = getScryPosts();
    posts.push(post);
    await writeScryPosts(posts);
  });
}

/**
 * Submits a new post. Every user writes directly now, GM or player
 * alike — there's no relay branch left here, since document ownership
 * means anyone with Owner permission on the journal can update it on
 * their own.
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
  return writeScryPost(post);
}

export function deleteScryPost(postId) {
  return serialize(async () => {
    const posts = getScryPosts().filter(p => p.id !== postId);
    await writeScryPosts(posts);
  });
}

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
    await writeScryPosts(posts);
  });
}

export function submitReaction(postId, kind, reactorKey, reactorName) {
  return applyReaction(postId, kind, reactorKey, reactorName);
}

export function adjustPhantomReaction(postId, kind, delta) {
  return serialize(async () => {
    const posts = getScryPosts();
    const idx = posts.findIndex(p => p.id === postId);
    if (idx === -1) return;
    const field = kind === "like" ? "phantomLikes" : "phantomDislikes";
    const current = posts[idx][field] ?? 0;
    posts[idx] = { ...posts[idx], [field]: Math.max(0, current + delta) };
    await writeScryPosts(posts);
  });
}

export function appendReply(postId, reply) {
  return serialize(async () => {
    const posts = getScryPosts();
    const idx = posts.findIndex(p => p.id === postId);
    if (idx === -1) return;
    const replies = [...(posts[idx].replies ?? []), reply];
    posts[idx] = { ...posts[idx], replies };
    await writeScryPosts(posts);
  });
}

export function deleteReply(postId, replyId) {
  return serialize(async () => {
    const posts = getScryPosts();
    const idx = posts.findIndex(p => p.id === postId);
    if (idx === -1) return;
    const replies = (posts[idx].replies ?? []).filter(r => r.id !== replyId);
    posts[idx] = { ...posts[idx], replies };
    await writeScryPosts(posts);
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
  return appendReply(postId, reply);
}
