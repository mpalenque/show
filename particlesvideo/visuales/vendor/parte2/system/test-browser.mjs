import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

/** Shared browser bootstrap for the Playwright-driven tests.
 * Resolution order: MILKY_PLAYWRIGHT (path to playwright-core/index.mjs) →
 * the local install used during development → `playwright` / `playwright-core`
 * from node_modules. Chrome: MILKY_BROWSER → the default Windows install →
 * Playwright's bundled Chromium. MILKY_BROWSER_ARGS ("a|b|c") adds launch flags.
 * Nothing here is a runtime dependency of the application. */
const DEVELOPMENT_PLAYWRIGHT = 'C:/Users/mpale/OneDrive/Desktop/heidi/visuales-piano-en-vivo/node_modules/playwright-core/index.mjs';
const DEFAULT_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export async function loadChromium() {
  const explicit = process.env.MILKY_PLAYWRIGHT;
  if (explicit) return (await import(pathToFileURL(explicit).href)).chromium;
  if (existsSync(DEVELOPMENT_PLAYWRIGHT)) return (await import(pathToFileURL(DEVELOPMENT_PLAYWRIGHT).href)).chromium;
  for (const name of ['playwright', 'playwright-core']) {
    try { return (await import(name)).chromium; } catch {}
  }
  throw new Error(`Playwright no encontrado. Definí MILKY_PLAYWRIGHT con la ruta a playwright-core/index.mjs o instalá playwright.`);
}

export function browserLaunchOptions(extra = {}) {
  const executablePath = process.env.MILKY_BROWSER || (existsSync(DEFAULT_CHROME) ? DEFAULT_CHROME : undefined);
  const args = process.env.MILKY_BROWSER_ARGS ? process.env.MILKY_BROWSER_ARGS.split('|') : undefined;
  return { headless: true, ...(executablePath ? { executablePath } : {}), ...(args ? { args } : {}), ...extra };
}

export async function launchChromium(extra = {}) {
  const chromium = await loadChromium();
  return chromium.launch(browserLaunchOptions(extra));
}
