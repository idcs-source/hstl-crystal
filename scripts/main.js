import { CrystalApp } from "./apps/crystal-app.js";
import { JobManagerApp } from "./apps/job-manager-app.js";
import { TrackerControlApp } from "./apps/tracker-control-app.js";
import { TextingManagerApp } from "./apps/texting-manager-app.js";
import { TrackerBar } from "./apps/tracker-bar.js";
import { writeScryPost, applyReaction, appendReply } from "./scry.js";
import { writeJobUpdate, acceptJobIfOpen } from "./jobs.js";
import { writeTracker } from "./tracker.js";
import { writeBank } from "./bank.js";
import { appendMessage } from "./texting.js";

const MODULE_ID = "hstl-crystal";

/** The one live CrystalApp instance for this client, reused on every open. */
let crystalAppInstance = null;

/* -------------------------------------------- */
/*  Settings                                     */
/* -------------------------------------------- */

Hooks.once("init", () => {
  // Registered defensively. Foundry core ships an "eq" helper already,
  // but registering our own guarantees this template works even if that
  // ever changes between versions.
  Handlebars.registerHelper("eq", (a, b) => a === b);

  // World-scoped job list. Seeded from data/jobs.json on first run.
  game.settings.register(MODULE_ID, "jobs", {
    name: "HSTL Job Listings",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Path to the crystal frame image. Drop your PNG in the assets folder
  // and point this at it, or change it via the Job Manager app later.
  game.settings.register(MODULE_ID, "frameImage", {
    name: "Crystal Frame Image",
    hint: "Path to the PNG used as the crystal device's background/frame.",
    scope: "world",
    config: true,
    type: String,
    default: `modules/${MODULE_ID}/assets/crystal-frame.png`
  });

  // Client-scoped (per browser/user, never synced to anyone else) home
  // screen wallpaper. This sits behind the app icons only — it never
  // touches the crystal's outer frame graphic, which stays a shared
  // world setting everyone sees the same way. Empty string means "no
  // wallpaper, just the plain background".
  game.settings.register(MODULE_ID, "homeWallpaper", {
    name: "My Home Screen Wallpaper",
    hint: "A personal wallpaper behind your own app icons. Only visible on this device.",
    scope: "client",
    config: false,
    type: String,
    default: ""
  });

  // Scry social feed. Starts empty; posts accumulate through play and
  // persist for the life of the world.
  game.settings.register(MODULE_ID, "scryPosts", {
    name: "Scry Posts",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // The single shared tracker bar. One GM-controlled object rather than
  // one per job, since only one job's checks are ever being tracked live
  // at a time — reused for every job rather than accumulating state.
  game.settings.register(MODULE_ID, "activeTracker", {
    name: "HSTL Active Tracker",
    scope: "world",
    config: false,
    type: Object,
    default: {
      active: false,
      jobId: null,
      label: "",
      slots: ["pending", "pending", "pending", "pending", "pending"]
    }
  });

  // The party's gold on hand and their Hollowell debt. All three values
  // are stored as raw silver counts (see bank.js) so gold/silver math on
  // the fly never has to worry about float rounding.
  game.settings.register(MODULE_ID, "bank", {
    name: "HSTL Bank",
    scope: "world",
    config: false,
    type: Object,
    default: {
      goldSilver: 0,
      debtTotalSilver: 0,
      debtPaidSilver: 0
    }
  });

  // Text message threads. Keyed by crystal (Actor id) then contact
  // (also an Actor id) — see texting.js for the shape. Grants (which
  // contacts show up on which crystal) live in the same object.
  game.settings.register(MODULE_ID, "texting", {
    name: "HSTL Texting",
    scope: "world",
    config: false,
    type: Object,
    default: {
      grants: {},
      threads: {}
    }
  });

  console.log("HSTL Crystal | Initialized");
});

/* -------------------------------------------- */
/*  Seed default jobs on first world load        */
/* -------------------------------------------- */

Hooks.once("ready", async () => {
  const existing = game.settings.get(MODULE_ID, "jobs");
  if (game.user.isGM && (!existing || existing.length === 0)) {
    try {
      const resp = await fetch(`modules/${MODULE_ID}/data/jobs.json`);
      const seed = await resp.json();
      await game.settings.set(MODULE_ID, "jobs", seed);
      console.log("HSTL Crystal | Seeded default job listings.");
    } catch (err) {
      console.warn("HSTL Crystal | Could not load default jobs.json seed.", err);
    }
  } else if (game.user.isGM && existing?.length) {
    // World was already seeded before the monsters field existed.
    // Backfill it onto any job missing it without touching anything
    // the GM has already customized (status, payout, etc.).
    let changed = false;
    const patched = existing.map(job => {
      if (job.monsters !== undefined && job.active !== undefined) return job;
      changed = true;
      return {
        ...job,
        monsters: job.monsters ?? [],
        active: job.active ?? true
      };
    });
    if (changed) {
      await game.settings.set(MODULE_ID, "jobs", patched);
      console.log("HSTL Crystal | Backfilled the monsters/active fields on existing job listings.");
    }
  }

  // One-time migration: threads used to be stored directionally as
  // threads[crystalId][contactId], which silently created a second,
  // out-of-sync copy of a conversation if it was ever viewed from the
  // other participant's crystal. They're now stored as one shared
  // thread per pair of participants. This converts anything already
  // written under the old shape rather than losing it.
  if (game.user.isGM) {
    const texting = game.settings.get(MODULE_ID, "texting");
    if (texting?.threads) {
      const isOldShape = Object.values(texting.threads).some(v => v && !Array.isArray(v));
      if (isOldShape) {
        const newThreads = {};
        for (const [crystalId, entry] of Object.entries(texting.threads)) {
          if (Array.isArray(entry)) {
            // Already new-shape data mixed in somehow — keep it as-is.
            newThreads[crystalId] = [...(newThreads[crystalId] ?? []), ...entry];
            continue;
          }
          for (const [contactId, messages] of Object.entries(entry ?? {})) {
            const key = [crystalId, contactId].sort().join("::");
            const migrated = (messages ?? []).map(m => ({
              id: m.id,
              senderId: m.sender === "self" ? crystalId : contactId,
              text: m.text,
              timestamp: m.timestamp
            }));
            newThreads[key] = [...(newThreads[key] ?? []), ...migrated];
          }
        }
        await game.settings.set(MODULE_ID, "texting", { ...texting, threads: newThreads });
        console.log("HSTL Crystal | Migrated texting threads to the new shared format.");
      }
    }
  }
});

/* -------------------------------------------- */
/*  Opening the crystal (singleton, explicit position) */
/* -------------------------------------------- */

/**
 * Opens the crystal. The singleton positions and sizes itself once, on
 * its own first render (see CrystalApp#_onFirstRender) — every call after
 * that just re-renders whatever instance already exists, so a reopen
 * lands exactly where the player last left it, dragged position included.
 */
async function openCrystal() {
  if (!crystalAppInstance) {
    crystalAppInstance = new CrystalApp();
  }
  await crystalAppInstance.render(true);
}

/* -------------------------------------------- */
/*  Socket relay for player-originated writes     */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  // Non-GM clients can't write world-scoped settings directly, so writes
  // that need to come from a player (Scry posts, job accepts) get relayed
  // here and the GM's client performs the actual write. The tracker has
  // no player-facing controls today, but updateTracker is handled here
  // too so it's relay-safe if that ever changes.
  game.socket.on(`module.${MODULE_ID}`, async (data) => {
    console.log(`[HSTL] socket message received by ${game.user.name} (isGM=${game.user.isGM})`, data);
    if (!game.user.isGM) return;
    console.log("[HSTL] processing on GM client, type:", data?.type);
    if (data?.type === "createScryPost" && data.post) {
      await writeScryPost(data.post);
    } else if (data?.type === "updateJob" && data.jobId) {
      await writeJobUpdate(data.jobId, data.changes ?? {});
    } else if (data?.type === "acceptJob" && data.jobId) {
      await acceptJobIfOpen(data.jobId, data.claimantName);
    } else if (data?.type === "updateTracker") {
      await writeTracker(data.changes ?? {});
    } else if (data?.type === "updateBank") {
      await writeBank(data.changes ?? {});
    } else if (data?.type === "reactToPost" && data.postId) {
      await applyReaction(data.postId, data.kind, data.reactorKey, data.reactorName);
    } else if (data?.type === "replyToPost" && data.postId && data.reply) {
      await appendReply(data.postId, data.reply);
    } else if (data?.type === "sendText" && data.crystalId && data.contactId) {
      await appendMessage(data.crystalId, data.contactId, data.text);
    } else {
      console.warn("[HSTL] socket message did not match any known type/shape — nothing was written", data);
    }
    console.log("[HSTL] relay handling complete for type:", data?.type);
  });
});

/* -------------------------------------------- */
/*  Mount the tracker bar and keep everything live */
/* -------------------------------------------- */

// Every client, GM included, mounts the (initially hidden) bar on load
// and lets it reflect whatever the current world state is.
Hooks.once("ready", () => {
  TrackerBar.render();
});

Hooks.on("updateSetting", (setting) => {
  const watched = [
    `${MODULE_ID}.scryPosts`,
    `${MODULE_ID}.jobs`,
    `${MODULE_ID}.activeTracker`,
    `${MODULE_ID}.bank`,
    `${MODULE_ID}.texting`
  ];
  if (!watched.includes(setting.key)) return;

  if (crystalAppInstance?.rendered) {
    crystalAppInstance.render();
  }
  if (setting.key === `${MODULE_ID}.activeTracker`) {
    TrackerBar.render();
    if (TrackerControlApp.instance?.rendered) {
      TrackerControlApp.instance.render();
    }
  }
  if (setting.key === `${MODULE_ID}.texting` && TextingManagerApp.instance?.rendered) {
    TextingManagerApp.instance.render();
  }
});

/* -------------------------------------------- */
/*  Docked open buttons                          */
/* -------------------------------------------- */

/**
 * Adds buttons to the Token layer's tool palette (the same toolbar
 * that holds Select/Ruler/Target) using Foundry's documented
 * getSceneControlButtons hook. This is core API, not something pieced
 * together from DOM structure, so it doesn't depend on sidebar
 * internals or any other module. The tracker control button only gets
 * added for the GM — players never get a way to open it, since the bar
 * itself is the only thing they're meant to see.
 */
Hooks.on("getSceneControlButtons", (controls) => {
  const tokenControls = controls.tokens;
  if (!tokenControls) return;

  tokenControls.tools["hstl-crystal"] = {
    name: "hstl-crystal",
    title: "Open Crystal",
    icon: "fa-solid fa-mobile-screen-button",
    order: Object.keys(tokenControls.tools).length,
    button: true,
    onChange: () => openCrystal()
  };

  if (game.user.isGM) {
    tokenControls.tools["hstl-tracker-control"] = {
      name: "hstl-tracker-control",
      title: "HSTL Tracker Control",
      icon: "fa-solid fa-clipboard-check",
      order: Object.keys(tokenControls.tools).length,
      button: true,
      onChange: () => TrackerControlApp.open()
    };
  }
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = {
    openCrystal,
    openJobManager: () => JobManagerApp.open(),
    openTrackerControl: () => TrackerControlApp.open(),
    openTextingManager: () => TextingManagerApp.open()
  };
});
