import { getJobs } from "../jobs.js";
import { getTracker, writeTracker, freshSlots } from "../tracker.js";

const MODULE_ID = "hstl-crystal";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-only. Activating sends the bar live for every connected client at
 * once, deactivating pulls it down for everyone at once — there's no
 * per-player visibility here, matching how a physical HUD bar would
 * work. Each of the 5 slots cycles pending -> success -> failure ->
 * pending on click, and every click writes straight to the world
 * setting so the bar updates live as rolls happen at the table.
 */
export class TrackerControlApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "hstl-tracker-control",
    classes: ["hstl-crystal", "hstl-tracker-control"],
    tag: "div",
    window: {
      frame: true,
      positioned: true,
      title: "HSTL — Tracker Control",
      icon: "fa-solid fa-clipboard-check",
      minimizable: true,
      resizable: true
    },
    position: {
      width: 360,
      height: 460
    },
    actions: {
      cycleSlot: TrackerControlApp.#onCycleSlot,
      toggleActive: TrackerControlApp.#onToggleActive,
      resetSlots: TrackerControlApp.#onResetSlots
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/tracker-control.hbs`
    }
  };

  static instance = null;

  /** Job currently selected in the dropdown, purely for label/monster lookup. */
  selectedJobId = null;

  static open() {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can open the tracker control panel.");
      return null;
    }
    if (!TrackerControlApp.instance) {
      TrackerControlApp.instance = new TrackerControlApp();
    }
    TrackerControlApp.instance.render(true);
    return TrackerControlApp.instance;
  }

  async _prepareContext(_options) {
    const tracker = getTracker();
    const jobs = getJobs();

    if (!this.selectedJobId && tracker.jobId) {
      this.selectedJobId = tracker.jobId;
    }
    const selectedJob = jobs.find(j => j.id === this.selectedJobId) ?? null;

    return {
      tracker,
      slots: tracker.slots.map((state, i) => ({ index: i, state })),
      jobs: jobs.map(j => ({ id: j.id, title: j.title, selected: j.id === this.selectedJobId })),
      selectedJob,
      hasMonsters: !!selectedJob?.monsters?.length,
      monsters: selectedJob?.monsters ?? []
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static #onSelectJob(_event, target) {
    this.selectedJobId = target.value || null;
    this.render();
  }

  /**
   * Bound manually rather than through data-action, same reasoning as
   * the Scry poster select and the Texting Manager's dropdowns — relying
   * on data-action's "change" handling for a <select> proved unreliable
   * here too.
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("change", (event) => {
      if (!event.target.matches?.("#hstl-tc-job-select")) return;
      TrackerControlApp.#onSelectJob.call(this, event, event.target);
    });
  }

  static async #onCycleSlot(_event, target) {
    const index = Number(target.dataset.index);
    const tracker = getTracker();
    const order = ["pending", "success", "failure"];
    const slots = [...tracker.slots];
    const current = order.indexOf(slots[index]);
    slots[index] = order[(current + 1) % order.length];
    await writeTracker({ slots });
    this.render();
  }

  static async #onResetSlots(_event, _target) {
    await writeTracker({ slots: freshSlots() });
    this.render();
  }

  /**
   * Activating pulls the label from the selected job's own tracker name
   * (falling back to its title) and resets all 5 slots, so starting a
   * new job's tracker never carries over marks from whatever ran before
   * it. Deactivating just flips the flag; the last slot state is left
   * alone in storage in case the GM meant to pause rather than end it.
   */
  static async #onToggleActive(_event, _target) {
    const tracker = getTracker();
    if (tracker.active) {
      await writeTracker({ active: false });
    } else {
      const jobs = getJobs();
      const job = jobs.find(j => j.id === this.selectedJobId) ?? null;
      await writeTracker({
        active: true,
        jobId: job?.id ?? null,
        label: job?.tracker || job?.title || "HSTL Job Check",
        slots: freshSlots()
      });
    }
    this.render();
  }
}
