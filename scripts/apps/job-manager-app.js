const MODULE_ID = "hstl-crystal";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM-only form for adding, editing, and removing HSTL job listings.
 * Saves back to the world setting `hstl-crystal.jobs`, which the
 * CrystalApp reads from directly.
 */
export class JobManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "hstl-job-manager",
    classes: ["hstl-crystal", "hstl-job-manager"],
    tag: "form",
    window: {
      title: "HSTL Job Manager",
      icon: "fa-solid fa-list-check",
      resizable: true
    },
    position: {
      width: 640,
      height: 720
    },
    form: {
      handler: JobManagerApp.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: false
    },
    actions: {
      addJob: JobManagerApp.#onAddJob,
      deleteJob: JobManagerApp.#onDeleteJob,
      saveOnly: JobManagerApp.#onSaveOnly
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/job-manager.hbs`
    }
  };

  /** Working copy of the job list, edited in memory until saved. */
  jobs = null;

  /** Singleton instance, reused across opens so closing and reopening works. */
  static instance = null;

  /** Opens (or re-shows) the one JobManagerApp instance for this client. */
  static open() {
    if (!JobManagerApp.instance) {
      JobManagerApp.instance = new JobManagerApp();
    }
    JobManagerApp.instance.render(true);
    return JobManagerApp.instance;
  }

  async _prepareContext(_options) {
    if (!this.jobs) {
      this.jobs = foundry.utils.deepClone(game.settings.get(MODULE_ID, "jobs") ?? []);
    }
    return { tierGroups: JobManagerApp.#groupByTier(this.jobs) };
  }

  static #groupByTier(jobs) {
    const byTier = new Map();
    for (const job of jobs) {
      const tier = job.tier || 1;
      if (!byTier.has(tier)) byTier.set(tier, []);
      byTier.get(tier).push(job);
    }
    return [...byTier.keys()].sort((a, b) => a - b).map(tier => ({
      tier,
      label: `Tier ${tier}`,
      jobs: byTier.get(tier)
    }));
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static #onAddJob(_event, _target) {
    this.jobs.push({
      id: foundry.utils.randomID(8),
      tier: 1,
      title: "New Listing",
      category: "",
      payout: 0,
      rating: 5,
      poster: "",
      description: "",
      tracker: "",
      status: "open",
      claimedBy: null,
      active: true
    });
    this.render();
  }

  static #onDeleteJob(_event, target) {
    const id = target.closest("[data-job-id]")?.dataset.jobId;
    this.jobs = this.jobs.filter(j => j.id !== id);
    this.render();
  }

  static async #onSaveOnly(_event, _target) {
    await this._saveFromForm();
    ui.notifications.info("HSTL job listings saved.");
  }

  /* -------------------------------------------- */
  /*  Form submission                              */
  /* -------------------------------------------- */

  static async #onSubmit(_event, _form, _formData) {
    await this._saveFromForm();
    ui.notifications.info("HSTL job listings saved.");
  }

  /**
   * Reads the current DOM form state back into this.jobs and persists it.
   * Merges into each job's existing data rather than rebuilding from
   * scratch, so fields the form doesn't expose (like claimedBy, set by a
   * player accepting the listing) survive a GM save instead of being
   * silently wiped out.
   */
  async _saveFromForm() {
    const rows = this.element.querySelectorAll("[data-job-id]");
    const byId = new Map(this.jobs.map(j => [j.id, j]));
    const updated = [];
    for (const row of rows) {
      const id = row.dataset.jobId;
      const existing = byId.get(id) ?? { id };
      const get = (field) => row.querySelector(`[name="${field}"]`)?.value ?? "";
      const status = get("status") || "open";
      const activeCheckbox = row.querySelector('[name="active"]');
      updated.push({
        ...existing,
        id,
        tier: Number(get("tier")) || 1,
        title: get("title"),
        category: get("category"),
        payout: Number(get("payout")) || 0,
        rating: Number(get("rating")) || 0,
        poster: get("poster"),
        description: get("description"),
        tracker: get("tracker"),
        status,
        active: activeCheckbox ? activeCheckbox.checked : true,
        // Reopening a listing through the status dropdown clears any
        // stale claimant rather than leaving a mismatched name behind.
        claimedBy: status === "open" ? null : (existing.claimedBy ?? null)
      });
    }
    this.jobs = updated;
    await game.settings.set(MODULE_ID, "jobs", updated);
  }
}
