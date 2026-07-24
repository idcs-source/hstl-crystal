# HSTL Crystal

A Foundry VTT V13/V14 module that spoofs the HSTL gig-work app as an in-world
phone UI. Adds a scene control toolbar button that opens a "crystal" device:
a home screen of app icons, an HSTL job list, and full job detail views, all
inside one window.

## Installation

1. Copy this whole folder into your Foundry `Data/modules/` directory, so the
   path reads `Data/modules/hstl-crystal/module.json`.
2. Enable **HSTL Crystal** in your world's Manage Modules screen.
3. Restart or reload the world.

## Adding your crystal artwork

Already done. `assets/crystal-frame.png` ships with your artwork in place, and
the screen area is aligned against it precisely: measured directly from the
image you provided, the usable screen sits at 5.769% / 8.254% from the
top-left and measures 88.248% / 85.291% of the frame, matching the 413x806
screen crop within the 468x945 full frame pixel-for-pixel. The window itself
opens at 390x788, the same aspect ratio, so nothing stretches.

If you ever swap in different artwork, re-measure the screen's offset within
the new image and update the percentages in `styles/hstl-crystal.css` under
`.crystal-screen` to match.

The status bar (clock, signal, battery) you'll notice in the reference image
is baked into the frame art itself, above where the screen crop starts, so
the app's own views don't render a duplicate one.

## Using it at the table

A small round button floats on the right edge of the screen, vertically
centered, near the sidebar. Click it to open the crystal. It opens on the
home screen. Clicking the HSTL icon switches to the scrollable job list.
Clicking a job card opens its full detail view. The back arrow in the
header returns to the previous screen.

The window is frameless on purpose, so it reads as a device rather than an
application window, which means there's no title bar and no native close
button. A small **×** sits in the top-right corner of the screen on every
view for closing it, or press Esc. Reopening it afterward is safe, the same
button brings the same window back, re-centered on your current screen size.

Any client, GM or player, can open their own crystal this way. It's a local
window, not a synced document, so each person's crystal is independent.

If you want the floating button somewhere else, open `styles/hstl-crystal.css`
and adjust the `#hstl-crystal-fab` rule's `top`/`right` values.

## Managing job listings

Job data lives in a world setting, seeded once from `data/jobs.json` the
first time the world loads with this module enabled. After that, the seed
file is only a reference; live edits happen through the world setting.

As GM, you'll see a **Manage** icon on the crystal's home screen, visible
only to you, that opens the job manager directly. It's also reachable from
the console or a macro:

```js
game.modules.get("hstl-crystal").api.openJobManager();
```

This opens a form listing every current job, grouped by tier, with editable
fields (title, tier, category, payout, rating, poster, tracker, status,
description), a delete button per row, and an "Add Listing" button that
appends a blank entry. Click **Save** to write changes back. Players see the
updated list next time they open HSTL on their crystal.

## Accepting and completing jobs

Players see listings grouped by tier on their crystal. Tapping a listing
opens its detail view, with an **Accept Listing** button if it's still open.

Accepting a listing does three things: posts a card to the public chat
naming who accepted what, marks the listing as claimed so nobody else can
also accept it, and shows "Claimed by [name]" instead of the Accept button
to anyone else who opens that same listing afterward.

As GM, opening a claimed listing's detail view shows a **Mark Complete**
button, which closes the listing out and removes it from the player-facing
list entirely (it still exists in the Manage form if you need to reopen or
edit it later). A **Reopen Listing** button is also available any time a
listing isn't currently open, in case something needs undoing, a
misclick, a job that fell through, whatever comes up.

Since accepting a listing needs to persist for everyone at the table, and
only the GM's client can write world data directly, player accepts relay
through the socket the same way Scry posts do. The chat message itself
posts immediately regardless, since chat isn't subject to that restriction.

## Scry

Scry is a second app on the crystal's home screen, a simple persistent
social feed separate from HSTL. Every post shows an avatar, a name, a
timestamp, and text, and the whole feed is stored in a world setting, so it
survives between sessions the same way job listings do.

**Posting as a player.** Whatever actor is currently assigned to a player as
their character (set via right-clicking their name in the Players list, or
under their user configuration) is who they post as. If no character is
assigned, the post falls back to their Foundry user name instead.

**Posting as GM.** You get a dropdown above the composer listing every actor
in the world, so you can post as any NPC, not just a character you're
personally assigned. Static Club chatter, Sprig customer complaints, Walt's
unhinged replies, whatever fits the scene, all doable from the same
composer just by picking who's "speaking."

**Deleting a post.** As GM, every post has a small trash icon in its
top-right corner. Players don't get one, there's no player-facing delete,
by design.

**Why this needs your session running.** Foundry only lets the GM's client
write world-scoped data directly. When a player posts, their crystal sends
it over the socket to your client, and your client performs the actual
save. This means player posts only go through while you're connected, the
same as any other change to shared world data, and is not specific to this
module.

## Extending it later

- **More apps on the home screen.** Add entries to the `apps` array built in
  `CrystalApp._prepareContext` (in `scripts/apps/crystal-app.js`), then add a
  matching view and template block, the same way `hstl-list` and
  `hstl-detail` work now.
- **Accepting a job from the detail view.** The Accept button in
  `templates/screen.hbs` is currently inert. Wire it to a new action in
  `CrystalApp.DEFAULT_OPTIONS.actions` if you want accepting a job to do
  something mechanical, like posting to chat or updating the job's status.
- **A JSON-first workflow instead of the form.** Since jobs live in a world
  setting, you can also just run
  `game.settings.set("hstl-crystal", "jobs", [...])` from the console with a
  hand-written array any time you want to fully replace the list.

## Compatibility note

Built against the V13/V14 ApplicationV2 API and the object-keyed
`getSceneControlButtons` format introduced in V13. It will not work on V12
or earlier without rewriting the scene control registration and the
Application classes to the older APIs.
