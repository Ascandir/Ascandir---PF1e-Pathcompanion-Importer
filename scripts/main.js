/**
 * Ascandir - PF1e Pathcompanion Importer – loader.
 *
 * This file never changes between versions. It loads the actual code with a
 * unique URL, so updates take effect even when a proxy or browser (e.g. a
 * Cloudflare tunnel) keeps serving old copies of files with a fixed name.
 */
import(`./core.js?t=${Date.now()}`).catch((err) => {
  console.error("ascandir-pf1e-pathcompanion-importer | Laden fehlgeschlagen", err);
});
