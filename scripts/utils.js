/**
 * Every world setting in this module (jobs, Scry, the tracker, the
 * bank, texting) is stored as one JSON blob, and every write to any of
 * them follows the same shape: read the current value, change one
 * piece of it, write the whole thing back. That's fine as long as
 * writes never overlap — but the GM routinely has more than one window
 * open at once (the phone and the Texting Manager, say), and two
 * writes fired close enough together can race: the second one reads
 * the data before the first one's save has actually landed, so its
 * write silently erases whatever the first one just added.
 *
 * `serialize` closes that gap by funneling every write in the module
 * through one shared queue, so a second write always waits for the
 * first to fully finish — read included — before it starts its own
 * read. It doesn't protect against two different physical clients
 * (two different browsers) writing at the exact same instant, Foundry
 * itself doesn't offer a way to guard against that with a plain world
 * setting, but that's a far rarer situation than one GM with two
 * windows open, which is what this actually fixes.
 */
let writeQueue = Promise.resolve();

export function serialize(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {});
  return run;
}
