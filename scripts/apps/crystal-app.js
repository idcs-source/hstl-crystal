import { JobManagerApp } from "./job-manager-app.js";
import { TextingManagerApp } from "./texting-manager-app.js";
import { CrystalControlApp } from "./crystal-control-app.js";
import {
  getScryPosts,
  submitScryPost,
  deleteScryPost,
  submitReaction,
  adjustPhantomReaction,
  submitReply,
  deleteReply
} from "../scry.js";
import { getJobs, submitJobUpdate, submitAcceptJob } from "../jobs.js";
import { getBank, adjustBankField, formatGoldSilver, partsToSilver } from "../bank.js";
import { getGrantedContacts, getThread, submitTextMessage, deleteMessage, getUnreadThreads, getUnreadForCrystal, submitMarkThreadRead } from "../texting.js";
import { getBrokenCrystals } from "../breakage.js";

const MODULE_ID = "hstl-crystal";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The crystal device window. Internally swaps between views:
 *   "home"        - grid of app icons
 *   "hstl-list"    - job postings grouped by tier
 *   "hstl-detail"  - full detail view of a single job, with accept/complete
 *   "scry-feed"    - Scry social wall, readable and writable
 */
export class CrystalApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** Intended size of the phone graphic itself, not counting the header. */
  static CONTENT_WIDTH = 390;
  static CONTENT_HEIGHT = 788;

  static DEFAULT_OPTIONS = {
    id: "hstl-crystal-app",
    classes: ["hstl-crystal"],
    tag: "div",
    window: {
      frame: true,
      positioned: true,
      title: "Crystal",
      icon: "fa-solid fa-mobile-screen-button",
      minimizable: false,
      resizable: false
    },
    position: {
      width: CrystalApp.CONTENT_WIDTH,
      height: CrystalApp.CONTENT_HEIGHT
    },
    actions: {
      openApp: CrystalApp.#onOpenApp,
      openJob: CrystalApp.#onOpenJob,
      goHome: CrystalApp.#onGoHome,
      goBackToList: CrystalApp.#onGoBackToList,
      postScry: CrystalApp.#onPostScry,
      deleteScry: CrystalApp.#onDeleteScry,
      deleteReply: CrystalApp.#onDeleteReply,
      acceptJob: CrystalApp.#onAcceptJob,
      markComplete: CrystalApp.#onMarkComplete,
      reopenJob: CrystalApp.#onReopenJob,
      likePost: CrystalApp.#onLike,
      dislikePost: CrystalApp.#onDislike,
      boostLike: CrystalApp.#onBoostLike,
      boostDislike: CrystalApp.#onBoostDislike,
      unboostLike: CrystalApp.#onUnboostLike,
      unboostDislike: CrystalApp.#onUnboostDislike,
      toggleReply: CrystalApp.#onToggleReplyBox,
      postReply: CrystalApp.#onPostReply,
      attachImage: CrystalApp.#onAttachImage,
      removeAttachedImage: CrystalApp.#onRemoveAttachedImage,
      customizeBackground: CrystalApp.#onCustomizeBackground,
      resetBackground: CrystalApp.#onResetBackground,
      adjustBank: CrystalApp.#onAdjustBank,
      openContact: CrystalApp.#onOpenContact,
      goBackToTexting: CrystalApp.#onGoBackToTexting,
      sendText: CrystalApp.#onSendText,
      deleteText: CrystalApp.#onDeleteText
    }
  };

  static PARTS = {
    screen: {
      template: `modules/${MODULE_ID}/templates/screen.hbs`
    }
  };

  /** @type {"home"|"hstl-list"|"hstl-detail"|"scry-feed"} */
  view = "home";

  /** @type {string|null} */
  selectedJobId = null;

  /** @type {string|null} GM's currently selected "post as" actor on Scry. */
  selectedPosterId = null;

  /** @type {string|null} Foundry file path staged for the next post, cleared once posted. */
  pendingImagePath = null;

  /** @type {string|null} Post id whose reply composer is currently expanded. */
  openReplyPostId = null;

  /** @type {number|null} Captured scroll offset restored after the next re-render. */
  _savedScrollTop = null;

  /** @type {Map<string, number>} Per-post GM boost amount, keyed by post id. Defaults to 1. */
  boostAmounts = new Map();

  /** @type {string|null} Which owned Actor's texting inbox is currently active. */
  selectedCrystalId = null;

  /** @type {string|null} Which contact's thread is currently open. */
  selectedContactId = null;

  /* -------------------------------------------- */
  /*  First-render sizing and centering            */
  /* -------------------------------------------- */

  /**
   * _onFirstRender fires exactly once, ever, for this instance (documented
   * ApplicationV2 lifecycle hook) — unlike _onRender, which fires on every
   * re-render. That makes it the right place to center the window: doing
   * this here, and nowhere else, means dragging the window and then
   * switching views or closing/reopening never resets its position, since
   * nothing after this hook ever calls setPosition again.
   */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);

    // Tag the header elements with our own classes via the documented
    // `window` getter, rather than assuming what core's internal class
    // names are, so our CSS only ever targets elements we chose ourselves.
    const { header, title, icon } = this.window ?? {};
    header?.classList.add("hstl-crystal-header");
    title?.classList.add("hstl-crystal-header-title");
    icon?.classList.add("hstl-crystal-header-icon");

    // window.frame adds a header above our content, and the header's
    // height counts against the total position.height. Measure it
    // directly (rather than assuming a pixel value) and grow the window
    // by exactly that much, so the phone graphic renders at its intended
    // CONTENT_WIDTH x CONTENT_HEIGHT instead of being squeezed underneath.
    const headerHeight = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
    const width = CrystalApp.CONTENT_WIDTH;
    const height = CrystalApp.CONTENT_HEIGHT + headerHeight;
    this.setPosition({
      width,
      height,
      left: Math.round((window.innerWidth - width) / 2),
      top: Math.round((window.innerHeight - height) / 2)
    });

    // Job cards are plain divs with role="button" (see screen.hbs) rather
    // than real <button> elements, to sidestep a native form-control
    // sizing quirk. That trade means Enter/Space activation isn't free
    // the way it is on a real button, so it's wired up here instead.
    // Bound once on this.element (the persistent app root, unlike the
    // "screen" part's content which gets replaced on every re-render).
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target.closest('[role="button"]');
      if (!target) return;
      event.preventDefault();
      target.click();
    });

    // Enter submits a composer, Shift+Enter inserts a newline like every
    // other chat app. Each composer's textarea sits next to exactly one
    // [data-action] button, so finding the nearest one of these three
    // containers and clicking whatever button it holds covers the main
    // Scry composer, a Scry reply composer, and the texting composer
    // without needing three separate handlers.
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (event.target.tagName !== "TEXTAREA") return;
      const container = event.target.closest(".scry-composer-row, .scry-reply-composer, .texting-composer");
      if (!container) return;
      event.preventDefault();
      container.querySelector("button[data-action]")?.click();
    });

    // The poster <select> gets recreated on every re-render, so this is
    // bound once via delegation on the stable app root instead of on the
    // element itself. Without this, selectedPosterId only ever updated
    // at the moment of submitting a new top-level post, which meant
    // switching the dropdown to reply or react as a different character
    // silently kept using whoever was last actually posted as.
    this.element.addEventListener("change", (event) => {
      if (event.target.matches?.(".scry-poster-select")) {
        this.selectedPosterId = event.target.value || null;
        this.render();
      } else if (event.target.matches?.(".texting-crystal-select")) {
        this.selectedCrystalId = event.target.value || null;
        this.selectedContactId = null;
        this.view = "texting-inbox";
        this.render();
      }
    });

    // Kept as an "input" listener rather than "change" so the typed
    // amount is already current the instant a boost button is clicked,
    // without needing the field to lose focus first. Doesn't re-render —
    // that would fight the user mid-keystroke — the value just sits in
    // this.boostAmounts until a boost/unboost click actually reads it.
    this.element.addEventListener("input", (event) => {
      if (!event.target.matches?.(".scry-boost-amount")) return;
      const postId = event.target.dataset.postId;
      const parsed = parseInt(event.target.value, 10);
      this.boostAmounts.set(postId, Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
    });
  }

  /* -------------------------------------------- */
  /*  Scroll position preservation                 */
  /* -------------------------------------------- */

  /**
   * The "screen" part's innerHTML is fully replaced on every render, which
   * on its own would reset any scrollable container back to the top —
   * reacting to a post you'd scrolled down to see would otherwise jump
   * you back to the newest post every time. _preRender/_onRender bracket
   * every render (first render included, before .scry-post-scroll even
   * exists yet, hence the guards), so this captures scrollTop right
   * before the DOM is replaced and restores it right after.
   */
  async _preRender(context, options) {
    await super._preRender(context, options);
    const scroller = this.element?.querySelector(".scry-post-scroll, .texting-thread-scroll");
    this._savedScrollTop = scroller ? scroller.scrollTop : null;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this._savedScrollTop == null) return;
    const scroller = this.element.querySelector(".scry-post-scroll, .texting-thread-scroll");
    if (scroller) scroller.scrollTop = this._savedScrollTop;
    this._savedScrollTop = null;
  }

  /* -------------------------------------------- */

  async _prepareContext(_options) {
    const isGM = game.user.isGM;

    // A broken crystal overrides everything else — no apps, no jobs,
    // no composer, regardless of what view the player was last on.
    // GMs are never affected by their own crystal being "broken" even
    // in theory, since Crystal Control only ever lists non-GM users.
    if (!isGM && getBrokenCrystals()[game.user.id] === true) {
      return {
        view: "broken",
        isGM: false,
        apps: [],
        frameImage: game.settings.get(MODULE_ID, "frameImage"),
        homeWallpaper: "",
        hasCustomBackground: false
      };
    }

    const frameImage = game.settings.get(MODULE_ID, "frameImage");
    const homeWallpaper = game.settings.get(MODULE_ID, "homeWallpaper");

    const myOwnedCrystals = (game.actors?.contents ?? []).filter(a => a.isOwner);
    const textsBadge = isGM
      ? 0
      : myOwnedCrystals.reduce((total, a) => total + Object.keys(getUnreadForCrystal(a.id)).length, 0);

    const apps = [
      { id: "hstl", label: "HSTL", image: `modules/${MODULE_ID}/assets/hstl-icon.png` },
      { id: "scry", label: "Scry", image: `modules/${MODULE_ID}/assets/scry-icon.png` },
      { id: "banking", label: "Banking", image: `modules/${MODULE_ID}/assets/banking-icon.png` },
      { id: "texting", label: "Texts", icon: "fa-solid fa-comment-sms", badge: textsBadge > 0 ? textsBadge : null }
    ];
    if (isGM) {
      apps.push({ id: "job-manager", label: "Manage", icon: "fa-solid fa-gear" });
      const unreadCount = getUnreadThreads().length;
      apps.push({
        id: "texting-manager",
        label: "Contacts",
        icon: "fa-solid fa-address-book",
        badge: unreadCount > 0 ? unreadCount : null
      });
      apps.push({ id: "crystal-control", label: "Crystals", icon: "fa-solid fa-bolt" });
    }

    const context = {
      frameImage,
      homeWallpaper,
      hasCustomBackground: !!homeWallpaper,
      view: this.view,
      apps,
      tierGroups: [],
      selectedJob: null,
      isGM,
      scryPosts: [],
      actorOptions: []
    };

    if (this.view === "hstl-list") {
      context.tierGroups = CrystalApp.#groupJobsByTier(getJobs(), isGM);
    }

    if (this.view === "hstl-detail" && this.selectedJobId) {
      const job = getJobs().find(j => j.id === this.selectedJobId) ?? null;
      if (job) {
        context.selectedJob = {
          ...job,
          canAccept: job.status === "open",
          isClaimed: job.status === "claimed",
          isClosed: job.status === "closed",
          canMarkComplete: isGM && job.status === "claimed",
          canReopen: isGM && job.status !== "open"
        };
      }
    }

    if (this.view === "scry-feed") {
      const myActors = isGM
        ? (game.actors?.contents ?? [])
        : (game.actors?.contents ?? []).filter(a => a.isOwner);

      if (!this.selectedPosterId && myActors.length) {
        const myCharacter = game.user.character;
        this.selectedPosterId = (!isGM && myCharacter && myActors.some(a => a.id === myCharacter.id))
          ? myCharacter.id
          : myActors[0].id;
      }
      context.actorOptions = myActors.map(a => ({
        id: a.id,
        name: a.name,
        selected: a.id === this.selectedPosterId
      }));

      const myKey = CrystalApp.#getActiveIdentity(this).key;
      const posts = getScryPosts();
      context.scryPosts = posts
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .map(p => {
          const likes = p.likes ?? {};
          const dislikes = p.dislikes ?? {};
          const phantomLikes = p.phantomLikes ?? 0;
          const phantomDislikes = p.phantomDislikes ?? 0;
          return {
            ...p,
            timeDisplay: new Date(p.timestamp).toLocaleString(),
            likeCount: Object.keys(likes).length + phantomLikes,
            dislikeCount: Object.keys(dislikes).length + phantomDislikes,
            likeSummary: CrystalApp.#formatReactionSummary(likes, phantomLikes),
            isLikedByMe: !!likes[myKey],
            isDislikedByMe: !!dislikes[myKey],
            boostAmount: this.boostAmounts.get(p.id) ?? 1,
            replyOpen: this.openReplyPostId === p.id,
            replies: (p.replies ?? []).map(r => ({
              ...r,
              timeDisplay: new Date(r.timestamp).toLocaleString()
            }))
          };
        });
      context.pendingImagePath = this.pendingImagePath;
    }

    if (this.view === "banking") {
      const bank = getBank();
      const gold = bank.goldSilver ?? 0;
      const debtTotal = bank.debtTotalSilver ?? 0;
      const debtPaid = bank.debtPaidSilver ?? 0;
      context.bank = {
        goldDisplay: formatGoldSilver(gold),
        debtTotalDisplay: formatGoldSilver(debtTotal),
        debtPaidDisplay: formatGoldSilver(debtPaid),
        debtRemainingDisplay: formatGoldSilver(Math.max(0, debtTotal - debtPaid))
      };
    }

    if (this.view === "texting-inbox" || this.view === "texting-thread") {
      const myCrystals = (game.actors?.contents ?? []).filter(a => a.isOwner);
      if (!this.selectedCrystalId && myCrystals.length) {
        this.selectedCrystalId = myCrystals[0].id;
      }
      context.crystalOptions = myCrystals.map(a => ({
        id: a.id,
        name: a.name,
        selected: a.id === this.selectedCrystalId
      }));

      const grantedIds = this.selectedCrystalId ? getGrantedContacts(this.selectedCrystalId) : [];
      const unreadByContact = this.selectedCrystalId ? getUnreadForCrystal(this.selectedCrystalId) : {};
      context.contacts = grantedIds
        .map(id => game.actors.get(id))
        .filter(Boolean)
        .map(a => ({ id: a.id, name: a.name, unreadCount: unreadByContact[a.id] ?? 0 }));

      if (this.view === "texting-thread") {
        const contact = this.selectedContactId ? game.actors.get(this.selectedContactId) : null;
        context.activeContactName = contact?.name ?? "Unknown";
        const thread = (this.selectedCrystalId && this.selectedContactId)
          ? getThread(this.selectedCrystalId, this.selectedContactId)
          : [];
        context.thread = thread.map(m => ({
          ...m,
          timeDisplay: new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          fromSelf: m.senderId === this.selectedCrystalId
        }));
      }
    }

    return context;
  }

  /** Groups jobs by tier, hiding closed/completed listings from the feed. */
  /**
   * "active" is the tier-gate — false means the GM hasn't unlocked this
   * listing yet (tracked against their own external rating system) and
   * it should never appear for players at all. The GM's own phone view
   * still shows inactive listings, tagged, so there's a way to sanity
   * check state without needing the full Job Manager.
   */
  static #groupJobsByTier(jobs, isGM) {
    const visible = jobs.filter(j => {
      if (j.status === "closed") return false;
      if (!isGM && j.active === false) return false;
      return true;
    });
    const byTier = new Map();
    for (const job of visible) {
      const tier = job.tier || 1;
      if (!byTier.has(tier)) byTier.set(tier, []);
      byTier.get(tier).push({
        ...job,
        payoutDisplay: `${job.payout}g`,
        isInactive: job.active === false
      });
    }
    return [...byTier.keys()].sort((a, b) => a - b).map(tier => ({
      tier,
      label: `Tier ${tier}`,
      jobs: byTier.get(tier)
    }));
  }

  /** Resolves the current user's display name and actor for chat/claims. */
  static #getCurrentIdentity() {
    const actor = game.user.character;
    return {
      actor,
      name: actor?.name ?? game.user.name
    };
  }

  /**
   * The identity behind every authoring action on Scry — posting,
   * replying, and reacting all resolve through this same function, so a
   * reaction always lines up with whichever character is currently
   * selected in the composer. Everyone gets the same dropdown now, GM
   * and players alike; a player who only owns one Actor just sees a
   * dropdown with one option, but this stops assuming a player can only
   * ever be their single assigned character — once they're granted an
   * NPC (looting a crystal, say), they need a way to post or reply as
   * that NPC too, not just their PC.
   */
  static #getActiveIdentity(app) {
    const actor = app.selectedPosterId ? game.actors.get(app.selectedPosterId) : null;
    return {
      key: actor?.id ?? game.user.id,
      actorId: actor?.id ?? null,
      name: actor?.name ?? game.user.name,
      img: actor?.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg"
    };
  }

  /**
   * Builds the "PLAYER A, PLAYER B, and 2000 others" style summary line.
   * Named reactors come from real per-identity likes; phantomCount folds
   * in the GM's deliberate bulk boosts as unnamed "others". Returns null
   * when there's nothing to show, and never leaves a dangling leading
   * comma when every reaction so far happens to be a phantom one.
   */
  static #formatReactionSummary(namedMap, phantomCount) {
    const names = Object.values(namedMap);
    const total = names.length + phantomCount;
    if (total === 0) return null;
    const shown = names.slice(0, 2);
    const others = total - shown.length;
    if (others <= 0) return shown.join(" and ");
    if (shown.length === 0) return `${others} other${others === 1 ? "" : "s"}`;
    return `${shown.join(", ")}, and ${others} other${others === 1 ? "" : "s"}`;
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static #onOpenApp(_event, target) {
    const appId = target.dataset.appId;
    if (appId === "hstl") {
      this.view = "hstl-list";
      this.render();
    } else if (appId === "scry") {
      this.view = "scry-feed";
      this.render();
    } else if (appId === "banking") {
      this.view = "banking";
      this.render();
    } else if (appId === "texting") {
      this.view = "texting-inbox";
      this.render();
    } else if (appId === "texting-manager") {
      TextingManagerApp.open();
    } else if (appId === "crystal-control") {
      CrystalControlApp.open();
    } else if (appId === "job-manager") {
      JobManagerApp.open();
    }
  }

  static #onOpenJob(_event, target) {
    this.selectedJobId = target.dataset.jobId;
    this.view = "hstl-detail";
    this.render();
  }

  static #onGoHome(_event, _target) {
    this.view = "home";
    this.selectedJobId = null;
    this.render();
  }

  static #onGoBackToList(_event, _target) {
    this.view = "hstl-list";
    this.selectedJobId = null;
    this.render();
  }

  static #onCloseApp(_event, _target) {
    this.close();
  }

  static async #onPostScry(_event, _target) {
    const textarea = this.element.querySelector('[name="scryPostText"]');
    const text = textarea?.value?.trim();
    if (!text) return;

    const { actorId, name: actorName, img: actorImg } = CrystalApp.#getActiveIdentity(this);
    await submitScryPost({ actorId, actorName, actorImg, text, imagePath: this.pendingImagePath });
    textarea.value = "";
    this.pendingImagePath = null;
    this.render();
  }

  static async #onDeleteScry(_event, target) {
    if (!game.user.isGM) return;
    const postId = target.closest("[data-post-id]")?.dataset.postId;
    if (!postId) return;
    await deleteScryPost(postId);
    this.render();
  }

  static async #onDeleteReply(_event, target) {
    if (!game.user.isGM) return;
    const postId = target.dataset.postId;
    const replyId = target.dataset.replyId;
    if (!postId || !replyId) return;
    await deleteReply(postId, replyId);
    this.render();
  }

  static async #onAcceptJob(_event, target) {
    const jobId = target.dataset.jobId;
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job || job.status !== "open") return;

    const { actor, name } = CrystalApp.#getCurrentIdentity();

    // Post to public chat immediately. This is independent of whether the
    // relayed claim ultimately succeeds, since chat posting isn't subject
    // to the same GM-only write restriction as world settings.
    await ChatMessage.create({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: name },
      content: `
        <div class="hstl-chat-card">
          <strong>${name}</strong> accepted an HSTL listing:
          <div class="hstl-chat-card-title">${job.title}</div>
          <div class="hstl-chat-card-meta">${job.payout}g &middot; ${job.category ?? ""}</div>
        </div>
      `
    });

    await submitAcceptJob(jobId, name);
    this.render();
  }

  static async #onMarkComplete(_event, target) {
    if (!game.user.isGM) return;
    const jobId = target.dataset.jobId;
    await submitJobUpdate(jobId, { status: "closed" });
    this.view = "hstl-list";
    this.selectedJobId = null;
    this.render();
  }

  static async #onReopenJob(_event, target) {
    if (!game.user.isGM) return;
    const jobId = target.dataset.jobId;
    await submitJobUpdate(jobId, { status: "open", claimedBy: null });
    this.render();
  }

  /* -------------------------------------------- */
  /*  Scry: reactions, replies, image attach       */
  /* -------------------------------------------- */

  /**
   * Like/Dislike always attribute to whoever is currently active — the
   * GM's selected dropdown character, or a player's assigned character.
   * The "and 2000 others" phantom flourish is a deliberate, separate GM
   * action now (see #onBoostLike/#onBoostDislike) rather than something
   * that happens automatically on every GM click.
   */
  static async #onLike(_event, target) {
    const postId = target.dataset.postId;
    const { key, name } = CrystalApp.#getActiveIdentity(this);
    await submitReaction(postId, "like", key, name);
    this.render();
  }

  static async #onDislike(_event, target) {
    const postId = target.dataset.postId;
    const { key, name } = CrystalApp.#getActiveIdentity(this);
    await submitReaction(postId, "dislike", key, name);
    this.render();
  }

  /** GM-only: stacks an unlimited, unattributed "others" reaction. */
  static async #onBoostLike(_event, target) {
    if (!game.user.isGM) return;
    const postId = target.dataset.postId;
    const amount = this.boostAmounts.get(postId) ?? 1;
    await adjustPhantomReaction(postId, "like", amount);
    this.render();
  }

  static async #onBoostDislike(_event, target) {
    if (!game.user.isGM) return;
    const postId = target.dataset.postId;
    const amount = this.boostAmounts.get(postId) ?? 1;
    await adjustPhantomReaction(postId, "dislike", amount);
    this.render();
  }

  /** GM-only: walks an overshot phantom count back down by the same typed amount. */
  static async #onUnboostLike(_event, target) {
    if (!game.user.isGM) return;
    const postId = target.dataset.postId;
    const amount = this.boostAmounts.get(postId) ?? 1;
    await adjustPhantomReaction(postId, "like", -amount);
    this.render();
  }

  static async #onUnboostDislike(_event, target) {
    if (!game.user.isGM) return;
    const postId = target.dataset.postId;
    const amount = this.boostAmounts.get(postId) ?? 1;
    await adjustPhantomReaction(postId, "dislike", -amount);
    this.render();
  }

  static #onToggleReplyBox(_event, target) {
    const postId = target.dataset.postId;
    this.openReplyPostId = this.openReplyPostId === postId ? null : postId;
    this.render();
  }

  static async #onPostReply(_event, target) {
    const postId = target.dataset.postId;
    const input = this.element.querySelector(`[data-reply-input-for="${postId}"]`);
    const text = input?.value?.trim();
    if (!text) return;

    const { actorId, name: actorName, img: actorImg } = CrystalApp.#getActiveIdentity(this);
    await submitReply(postId, { actorId, actorName, actorImg, text });
    this.openReplyPostId = null;
    this.render();
  }

  /**
   * Opens Foundry's own FilePicker to stage an image for the next post.
   * Note: by default only the GM can browse/upload files — a player
   * will get a permission error here unless the GM enables "Use File
   * Browser" for players under World Settings > Permissions.
   */
  static #onAttachImage(_event, _target) {
    const FilePickerImpl = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    const picker = new FilePickerImpl({
      type: "image",
      callback: (path) => {
        this.pendingImagePath = path;
        this.render();
      }
    });
    picker.render(true);
  }

  static #onRemoveAttachedImage(_event, _target) {
    this.pendingImagePath = null;
    this.render();
  }

  /**
   * A client-scoped setting write, unlike everything else in this app.
   * No GM-relay needed here at all — "client" scope lives in this one
   * browser's local storage and was never shared to begin with, so a
   * player setting their own background can't affect, and isn't visible
   * to, anyone else's crystal.
   */
  static #onCustomizeBackground(_event, _target) {
    const FilePickerImpl = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    const picker = new FilePickerImpl({
      type: "image",
      callback: async (path) => {
        await game.settings.set(MODULE_ID, "homeWallpaper", path);
        this.render();
      }
    });
    picker.render(true);
  }

  static async #onResetBackground(_event, _target) {
    await game.settings.set(MODULE_ID, "homeWallpaper", "");
    this.render();
  }

  /**
   * One handler for all three adjusters (gold, debt total, debt paid) —
   * which field it touches comes from data-target on the clicked button,
   * matching the id="bank-adjust-{target}-gold/-silver" inputs next to
   * it. "add"/"subtract" do the gold+silver math against the stored
   * total; "set" replaces it outright, useful for entering the number
   * for the first time rather than building it up from zero. Everything
   * is clamped to a minimum of 0 — no negative gold or negative debt.
   */
  static async #onAdjustBank(_event, target) {
    if (!game.user.isGM) return;
    const key = target.dataset.target;
    const mode = target.dataset.mode;
    const fieldMap = { gold: "goldSilver", debtTotal: "debtTotalSilver", debtPaid: "debtPaidSilver" };
    const field = fieldMap[key];
    if (!field) return;

    const goldInput = this.element.querySelector(`#bank-adjust-${key}-gold`);
    const silverInput = this.element.querySelector(`#bank-adjust-${key}-silver`);
    const deltaSilver = partsToSilver(goldInput?.value, silverInput?.value);

    await adjustBankField(field, mode, deltaSilver);
    if (goldInput) goldInput.value = "";
    if (silverInput) silverInput.value = "";
    this.render();
  }

  /* -------------------------------------------- */
  /*  Texting                                      */
  /* -------------------------------------------- */

  static async #onOpenContact(_event, target) {
    this.selectedContactId = target.dataset.contactId;
    this.view = "texting-thread";
    if (this.selectedCrystalId && this.selectedContactId) {
      await submitMarkThreadRead(this.selectedCrystalId, this.selectedContactId, this.selectedCrystalId);
      // The GM's own Needs Reply tracking is a separate marker from any
      // one crystal's — without this, testing or reading a thread via
      // the phone would never clear the badge on the Contacts icon,
      // only actually opening it through the Manager would.
      if (game.user.isGM) {
        await submitMarkThreadRead(this.selectedCrystalId, this.selectedContactId, "__gm__");
      }
    }
    this.render();
  }

  static #onGoBackToTexting(_event, _target) {
    this.view = "texting-inbox";
    this.selectedContactId = null;
    this.render();
  }

  static async #onSendText(_event, _target) {
    const textarea = this.element.querySelector('[name="textingMessage"]');
    const text = textarea?.value?.trim();
    if (!text || !this.selectedCrystalId || !this.selectedContactId) return;
    await submitTextMessage(this.selectedCrystalId, this.selectedContactId, text);
    await submitMarkThreadRead(this.selectedCrystalId, this.selectedContactId, this.selectedCrystalId);
    if (game.user.isGM) {
      await submitMarkThreadRead(this.selectedCrystalId, this.selectedContactId, "__gm__");
    }
    textarea.value = "";
    this.render();
  }

  static async #onDeleteText(_event, target) {
    if (!game.user.isGM) return;
    const messageId = target.dataset.messageId;
    if (!messageId || !this.selectedCrystalId || !this.selectedContactId) return;
    await deleteMessage(this.selectedCrystalId, this.selectedContactId, messageId);
    this.render();
  }
}
