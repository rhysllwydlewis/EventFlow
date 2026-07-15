import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function updateFile(relativePath, replacements) {
  const file = path.join(ROOT, relativePath);
  let source = fs.readFileSync(file, 'utf8');

  for (const [before, after] of replacements) {
    if (!source.includes(before)) {
      throw new Error(`Expected source fragment not found in ${relativePath}: ${before}`);
    }
    source = source.replace(before, after);
  }

  fs.writeFileSync(file, source);
}

updateFile('src/homepages/home-v2.ts', [
  [
    "  const menuButton = document.querySelector('.hv2-menu');\n  const mobileNav = document.getElementById('hv2-mobile-nav');\n  const categoryField = document.getElementById('hv2-category');\n  const keywordField = document.getElementById('hv2-keyword');\n  const locationField = document.getElementById('hv2-location');\n  const searchForm = document.querySelector('.hv2-search');\n  const heroImage = document.querySelector('.hv2-hero__image');\n  const popularButtons = document.querySelectorAll('.hv2-popular button[data-category]');\n  const revealTargets = document.querySelectorAll(\n",
    "  const menuButton = document.querySelector<HTMLButtonElement>('.hv2-menu');\n  const mobileNav = document.getElementById('hv2-mobile-nav');\n  const categoryField = document.getElementById('hv2-category') as HTMLSelectElement | null;\n  const keywordField = document.getElementById('hv2-keyword') as HTMLInputElement | null;\n  const locationField = document.getElementById('hv2-location') as HTMLInputElement | null;\n  const searchForm = document.querySelector<HTMLFormElement>('.hv2-search');\n  const heroImage = document.querySelector<HTMLElement>('.hv2-hero__image');\n  const popularButtons = document.querySelectorAll<HTMLButtonElement>(\n    '.hv2-popular button[data-category]'\n  );\n  const revealTargets = document.querySelectorAll<HTMLElement>(\n",
  ],
  [
    "    document.addEventListener('focusin', event => {\n      if (!mobileNav.hidden && !mobileNav.contains(event.target) && event.target !== menuButton) {\n        closeMenu();\n      }\n    });\n",
    "    document.addEventListener('focusin', event => {\n      const target = event.target;\n      if (\n        target instanceof Node &&\n        !mobileNav.hidden &&\n        !mobileNav.contains(target) &&\n        target !== menuButton\n      ) {\n        closeMenu();\n      }\n    });\n",
  ],
  [
    "      const submitButton = searchForm.querySelector('.hv2-search__button');",
    "      const submitButton = searchForm.querySelector<HTMLButtonElement>('.hv2-search__button');",
  ],
]);

updateFile('src/homepages/home-v3.ts', [
  [
    "      const requestUrl = typeof input === 'string' ? input : input?.url || '';",
    "      const requestUrl =\n        typeof input === 'string'\n          ? input\n          : input instanceof URL\n            ? input.href\n            : input.url;",
  ],
  [
    "    const select = document.querySelector('[data-hv3-event-select]');\n    const input = document.getElementById('hv2-event-type');",
    "    const select = document.querySelector<HTMLElement>('[data-hv3-event-select]');\n    const input = document.getElementById('hv2-event-type') as HTMLInputElement | null;",
  ],
  [
    "    const trigger = select.querySelector('[data-hv3-select-button]');\n    const label = select.querySelector('[data-hv3-event-label]');\n    const menu = select.querySelector('[data-hv3-select-menu]');\n    const options = Array.from(select.querySelectorAll('[data-hv3-event-option]'));",
    "    const trigger = select.querySelector<HTMLButtonElement>('[data-hv3-select-button]');\n    const label = select.querySelector<HTMLElement>('[data-hv3-event-label]');\n    const menu = select.querySelector<HTMLElement>('[data-hv3-select-menu]');\n    const options = Array.from(\n      select.querySelectorAll<HTMLButtonElement>('[data-hv3-event-option]')\n    );",
  ],
  [
    "    select.addEventListener('keydown', event => {",
    "    select.addEventListener('keydown', (event: KeyboardEvent) => {",
  ],
  [
    "    document.addEventListener('click', event => {\n      if (!select.contains(event.target)) {\n        closeMenu();\n      }\n    });",
    "    document.addEventListener('click', event => {\n      const target = event.target;\n      if (target instanceof Node && !select.contains(target)) {\n        closeMenu();\n      }\n    });",
  ],
  ["    const timers = new Set();", "    const timers = new Set<number>();"],
  ["    let activeGuide = null;", "    let activeGuide: HTMLElement | null = null;"],
  [
    "    function queue(callback, delay) {",
    "    function queue(callback: () => void, delay: number) {",
  ],
  ["    function clearQueued(timer) {", "    function clearQueued(timer: number) {"],
  ["    function nextFrame(callback) {", "    function nextFrame(callback: () => void) {"],
  [
    "    function isVisibleElement(element) {\n      if (!element) {\n        return false;\n      }\n\n      const rect = element.getBoundingClientRect();",
    "    function isVisibleElement(element: Element | null): element is HTMLElement {\n      if (!(element instanceof HTMLElement)) {\n        return false;\n      }\n\n      const rect = element.getBoundingClientRect();",
  ],
  [
    "    function findByText(selector, pattern) {\n      return Array.from(document.querySelectorAll(selector)).find(element => {",
    "    function findByText(selector: string, pattern: RegExp): HTMLElement | undefined {\n      return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(element => {",
  ],
  [
    "    function findGuideTarget(variant) {",
    "    function findGuideTarget(variant: string): HTMLElement | null | undefined {",
  ],
  [
    "        return document.querySelector('.hv2-search__button');",
    "        return document.querySelector<HTMLButtonElement>('.hv2-search__button');",
  ],
  [
    "        document.querySelector('a[href=\"/login\"], a[href=\"/login.html\"], a[href*=\"/login\"]') ||",
    "        document.querySelector<HTMLAnchorElement>(\n          'a[href=\"/login\"], a[href=\"/login.html\"], a[href*=\"/login\"]'\n        ) ||",
  ],
  [
    "    function findGuideAvoidRect(target, variant) {",
    "    function findGuideAvoidRect(target: HTMLElement, variant: string) {",
  ],
  [
    "    function placeGuide(guide, target, variant, measuredTargetRect) {",
    "    function placeGuide(\n      guide: HTMLElement,\n      target: HTMLElement,\n      variant: string,\n      measuredTargetRect?: DOMRect\n    ) {",
  ],
  [
    "    function hideGuide(guide, onRemoved) {",
    "    function hideGuide(guide: HTMLElement | null, onRemoved?: () => void) {",
  ],
  [
    "    function showGuide(config, duration, onRemoved) {",
    "    function showGuide(config, duration: number, onRemoved?: () => void) {",
  ],
  [
    "    const searchForm = document.querySelector('.hv2-search');",
    "    const searchForm = document.querySelector<HTMLFormElement>('.hv2-search');",
  ],
  [
    "    document.addEventListener('click', event => {\n      if (event.target.closest('.hv2-search__button, a[href*=\"/login\"]')) {\n        stopGuideSequence();\n      }\n    });",
    "    document.addEventListener('click', event => {\n      if (\n        event.target instanceof Element &&\n        event.target.closest('.hv2-search__button, a[href*=\"/login\"]')\n      ) {\n        stopGuideSequence();\n      }\n    });",
  ],
]);

updateFile('src/homepages/home-v3-video.ts', [
  [
    "  function getCropMetrics(container, item, video) {",
    "  function getCropMetrics(container, item, video = null) {",
  ],
  [
    "  function getHeroVideoTargetWidth(settings = {}) {",
    "  function getHeroVideoTargetWidth(settings: HomepageVideoSettings = {}) {",
  ],
  [
    "  function videoPassesContentFilters(video, settings = {}) {",
    "  function videoPassesContentFilters(video, settings: HomepageVideoSettings = {}) {",
  ],
  [
    "  function chooseHeroVideoFile(video, settings = {}) {",
    "  function chooseHeroVideoFile(video, settings: HomepageVideoSettings = {}) {",
  ],
  [
    "  function buildUploadPlaylist(settings = {}) {",
    "  function buildUploadPlaylist(settings: HomepageVideoSettings = {}) {",
  ],
  [
    "  function buildSelectedPlaylist(settings = {}) {",
    "  function buildSelectedPlaylist(settings: HomepageVideoSettings = {}) {",
  ],
  [
    "  function buildPexelsPlaylist(videos, settings = {}) {",
    "  function buildPexelsPlaylist(videos, settings: HomepageVideoSettings = {}) {",
  ],
  [
    "  function getPreferredVideoQuery(settings = {}) {",
    "  function getPreferredVideoQuery(settings: HomepageVideoSettings = {}) {",
  ],
  [
    "  function getRotationDelay(settings = {}) {",
    "  function getRotationDelay(settings: HomepageVideoSettings = {}) {",
  ],
  [
    "  function shouldDisableHeroVideo(settings = {}) {",
    "  function shouldDisableHeroVideo(settings: HomepageVideoSettings = {}) {",
  ],
  [
    "  function applyTransitionSettings(container, settings = {}) {",
    "  function applyTransitionSettings(container, settings: HomepageVideoSettings = {}) {",
  ],
  [
    "  function applyPlaybackSettings(video, settings = {}) {",
    "  function applyPlaybackSettings(video, settings: HomepageVideoSettings = {}) {",
  ],
  [
    "  function applyHoverPause(container, video, settings = {}, shouldPlay) {",
    "  function applyHoverPause(\n    container,\n    video,\n    settings: HomepageVideoSettings = {},\n    shouldPlay\n  ) {",
  ],
  [
    "  async function loadHomepageVideoSettings() {\n    const defaults = {",
    "  async function loadHomepageVideoSettings(): Promise<HomepageVideoSettings> {\n    const defaults: HomepageVideoSettings = {",
  ],
  [
    "  async function fetchPexelsPlaylist(settings) {",
    "  async function fetchPexelsPlaylist(settings: HomepageVideoSettings) {",
  ],
  [
    "    const container = document.querySelector('[data-hv3-pexels-video]');\n    const video = container?.querySelector('[data-hv3-video-media]');\n    const source = container?.querySelector('[data-hv3-video-source]');",
    "    const container = document.querySelector<HTMLElement>('[data-hv3-pexels-video]');\n    const video = container?.querySelector<HTMLVideoElement>('[data-hv3-video-media]');\n    const source = container?.querySelector<HTMLSourceElement>('[data-hv3-video-source]');",
  ],
  [
    "    const categoryField = document.getElementById('hv2-category');\n    const keywordField = document.getElementById('hv2-keyword');\n    const locationField = document.getElementById('hv2-location');\n    const searchForm = document.querySelector('.hv2-search');\n    const popularButtons = document.querySelectorAll('.hv2-popular button[data-category]');",
    "    const categoryField = document.getElementById('hv2-category') as HTMLSelectElement | null;\n    const keywordField = document.getElementById('hv2-keyword') as HTMLInputElement | null;\n    const locationField = document.getElementById('hv2-location') as HTMLInputElement | null;\n    const searchForm = document.querySelector<HTMLFormElement>('.hv2-search');\n    const popularButtons = document.querySelectorAll<HTMLButtonElement>(\n      '.hv2-popular button[data-category]'\n    );",
  ],
  [
    "    const searchForm = document.querySelector('.hv2-search');",
    "    const searchForm = document.querySelector<HTMLFormElement>('.hv2-search');",
  ],
  [
    "      const submitButton = searchForm.querySelector('.hv2-search__button');",
    "      const submitButton = searchForm.querySelector<HTMLButtonElement>('.hv2-search__button');",
  ],
]);

console.log('Applied homepage TypeScript fixes.');
