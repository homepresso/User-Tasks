/**
 * The document a custom form control runs in, and its security headers.
 *
 * Every control instance is an <iframe sandbox="allow-scripts"> (no
 * allow-same-origin: an opaque origin with no access to the app's cookies,
 * storage, DOM or session) whose src is the frame route
 * (app/form-controls/frame/[tag]/[version]/route.ts). That route answers
 * with this document:
 *
 *   - the control's ES module inlined (snapshotted in the library — never a
 *     third-party URL), plus the bridge runtime (FRAME_RUNTIME below);
 *   - a CSP that allows exactly those two scripts (by sha-256 hash), inline
 *     styles, data:/blob: images, fonts and media — and nothing else: no
 *     network (connect-src 'none') unless the manifest declared hosts AND an
 *     admin approved them, no frames, workers, forms, plugins or base tag,
 *     `sandbox allow-scripts` again (so opening the URL directly is just as
 *     isolated) and frame-ancestors 'self' (only the app may embed it).
 *
 * Residual risk (documented): a control can always leak what it is given
 * (its value, declared context, theme) by navigating its own frame; the
 * host treats a second frame load as a navigation and tears the frame down.
 *
 * Pure (node:crypto-free: hashes come from the caller), so it is testable.
 */

import { CONTROL_EVENTS, RESERVED_ELEMENT_PROPERTIES, THEME_TOKENS, type FormControlManifest } from './contract'

export const FRAME_PATH_PREFIX = '/form-controls/frame/'
export const BUNDLE_PATH_PREFIX = '/form-controls/bundle/'

/** Path of a control version's frame document. */
export function frameUrl(tag: string, version: string, params: { task?: string | null; workspace?: string | null; anonymous?: string | null } = {}): string {
  const query = new URLSearchParams()
  // A public form link (anonymous visitors): the link token picks the form and workspace.
  if (params.anonymous) query.set('p', params.anonymous)
  if (params.task) query.set('task', params.task)
  if (params.workspace) query.set('w', params.workspace)
  const qs = query.toString()
  return `${FRAME_PATH_PREFIX}${encodeURIComponent(tag)}/${encodeURIComponent(version)}${qs ? `?${qs}` : ''}`
}

/** Path of a TRUSTED control's module (rendered inline in the page). */
export function bundleUrl(tag: string, version: string): string {
  return `${BUNDLE_PATH_PREFIX}${encodeURIComponent(tag)}/${encodeURIComponent(version)}.js`
}

/**
 * Make module source safe to inline in a <script> element: `</script` and
 * `<!--` can't end or confuse the element. Both are rewritten with unicode
 * escapes, which mean the same characters inside strings, template
 * literals, regular expressions (including /u) and comments — the only
 * places they can occur in a valid module.
 */
export function inlineScriptSafe(source: string): string {
  return source.replace(/<\/(script)/gi, '<\\u002f$1').replace(/<!--/g, '<\\u0021--')
}

/** JSON for a <script type="application/json"> block. */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/** connect-src sources for approved hosts (https only). */
export function connectSources(approvedHosts: readonly string[]): string {
  const sources = approvedHosts.map((host) => `https://${host}`)
  return sources.length ? sources.join(' ') : "'none'"
}

/** The frame's Content-Security-Policy (script hashes: base64 sha-256 of each inline script's exact text). */
export function frameContentSecurityPolicy(opts: { scriptHashes: string[]; approvedHosts: readonly string[] }): string {
  return [
    "default-src 'none'",
    `script-src ${opts.scriptHashes.map((h) => `'sha256-${h}'`).join(' ')}`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    `connect-src ${connectSources(opts.approvedHosts)}`,
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    'sandbox allow-scripts',
  ].join('; ')
}

/** Headers of the frame response (besides the CSP). */
export const FRAME_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), clipboard-read=(), display-capture=(), fullscreen=()',
  // Versions are immutable; a short private cache keeps forms fast while a
  // disabled control stops loading within minutes.
  'Cache-Control': 'private, max-age=300',
}

/** Configuration the runtime reads (inert JSON). */
export interface FrameConfig {
  tag: string
  version: string
  /** Declared prop names the runtime also sets as element properties. */
  props: string[]
  tokens: readonly string[]
  events: typeof CONTROL_EVENTS
  /** Milliseconds to wait for customElements.define(tag). */
  defineTimeout: number
}

export function frameConfig(manifest: Pick<FormControlManifest, 'tag' | 'version' | 'props'>): FrameConfig {
  return {
    tag: manifest.tag,
    version: manifest.version,
    props: manifest.props.map((p) => p.name).filter((name) => !RESERVED_ELEMENT_PROPERTIES.has(name)),
    tokens: THEME_TOKENS,
    events: CONTROL_EVENTS,
    defineTimeout: 8000,
  }
}

/**
 * The bridge runtime inside the frame (plain ES5-ish JS, no dependencies).
 * Accepts host messages only from window.parent at the app origin with this
 * frame's channel; creates the element once the module has defined it;
 * forwards the contract events; measures height; answers focus requests;
 * reports load errors.
 */
export const FRAME_RUNTIME = `(function () {
  'use strict';
  var cfg = JSON.parse(document.getElementById('ut-config').textContent);
  var channel = (/[#&]c=([a-f0-9]{16,64})/.exec(location.hash) || [])[1] || '';
  var parentOrigin = location.origin;
  var el = null, pending = {}, seq = 0, lastHeight = -1, applied = {}, initialised = false, defined = false, shown = false;
  // The host's light / dark mode rides in the hash so the very first paint matches the form (no white flash).
  var hashMode = (/[#&]m=(dark|light)/.exec(location.hash) || [])[1];
  if (hashMode) { document.documentElement.style.colorScheme = hashMode; document.documentElement.setAttribute('data-theme', hashMode); }
  var STATE_KEYS = ['value', 'disabled', 'readonly', 'required', 'invalid', 'error', 'props', 'theme', 'locale', 'context', 'label', 'description', 'capabilities'];
  function post(msg) {
    if (!channel || window.parent === window) return;
    msg.ut = 1; msg.channel = channel;
    try { window.parent.postMessage(msg, parentOrigin); } catch (e) { /* not serialisable */ }
  }
  function fail(message) { post({ type: 'error', message: String(message || 'The control failed').slice(0, 500) }); }
  window.addEventListener('error', function (e) { fail(e && e.message); });
  window.addEventListener('unhandledrejection', function (e) { fail(e && e.reason && e.reason.message || 'Unhandled error in the control'); });
  function measure() {
    // Nothing is reported before the element has painted with its state: no collapse to 0, no jump.
    if (!shown) return;
    var root = document.getElementById('ut-root');
    var h = Math.ceil(Math.max(root.scrollHeight, root.getBoundingClientRect().height));
    if (h !== lastHeight) { lastHeight = h; post({ type: 'resize', height: h }); }
  }
  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    var style = document.documentElement.style;
    var tokens = theme.tokens || {};
    for (var i = 0; i < cfg.tokens.length; i++) {
      var name = cfg.tokens[i], v = tokens[name];
      if (typeof v === 'string' && v.length < 300 && !/[;{}]|url\\(/i.test(v)) style.setProperty('--' + name, v); else style.removeProperty('--' + name);
    }
    style.colorScheme = theme.mode === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme.mode === 'dark' ? 'dark' : 'light');
  }
  function apply(state) {
    if (!state || typeof state !== 'object') return;
    if ('theme' in state) applyTheme(state.theme);
    if (typeof state.locale === 'string') document.documentElement.lang = state.locale;
    if (typeof state.label === 'string') document.title = state.label;
    for (var k in state) if (Object.prototype.hasOwnProperty.call(state, k)) applied[k] = state[k];
    if (!el) return;
    for (var i = 0; i < STATE_KEYS.length; i++) {
      var key = STATE_KEYS[i];
      if (!(key in state)) continue;
      try { el[key] = state[key]; } catch (e) { /* read-only property */ }
    }
    if (state.props && typeof state.props === 'object') {
      for (var j = 0; j < cfg.props.length; j++) {
        var p = cfg.props[j];
        if (Object.prototype.hasOwnProperty.call(state.props, p)) { try { el[p] = state.props[p]; } catch (e) { /* ignore */ } }
      }
    }
    if ('readonly' in state) { try { el.readOnly = !!state.readonly; } catch (e) { /* ignore */ } }
    if ('label' in state) { try { el.setAttribute('aria-label', state.label || ''); } catch (e) { /* ignore */ } }
    setTimeout(measure, 0);
  }
  function detail(e) { return e && e.detail && typeof e.detail === 'object' ? e.detail : {}; }
  function mount() {
    // Only once the module defined the element AND the host's init state arrived: the element's
    // first render already has its value, theme and props.
    if (el || !defined || !initialised) return;
    el = document.createElement(cfg.tag);
    apply(applied);
    el.addEventListener(cfg.events.change, function (e) { var d = detail(e); post({ type: 'change', value: 'value' in d ? d.value : el.value }); });
    el.addEventListener(cfg.events.blur, function () { post({ type: 'blur' }); });
    el.addEventListener(cfg.events.validity, function (e) { var d = detail(e); post({ type: 'validity', valid: d.valid !== false, message: typeof d.message === 'string' ? d.message : undefined }); });
    el.addEventListener(cfg.events.resize, function (e) { var d = detail(e); if (typeof d.height === 'number') post({ type: 'resize', height: d.height }); });
    el.addEventListener(cfg.events.request, function (e) {
      var d = detail(e), id = 'r' + (++seq);
      if (typeof d.resolve !== 'function' || typeof d.reject !== 'function') return;
      pending[id] = d;
      post({ type: 'request', request_id: id, kind: d.kind, payload: d.payload });
    });
    document.getElementById('ut-root').appendChild(el);
    if (window.ResizeObserver) new ResizeObserver(measure).observe(document.getElementById('ut-root'));
    // Ready = rendered: after the element's own first update (Lit's updateComplete; a timer, not
    // requestAnimationFrame, which browsers throttle in off-screen frames), report the real height,
    // then ready — the host reveals the control at its final size.
    var settle = el.updateComplete && typeof el.updateComplete.then === 'function' ? el.updateComplete : Promise.resolve();
    var done = false;
    function show() {
      if (done) return; done = true;
      setTimeout(function () { shown = true; measure(); post({ type: 'ready', tag: cfg.tag, version: cfg.version }); }, 0);
    }
    settle.then(show, show);
    setTimeout(show, 300);
  }
  function focusControl(from) {
    if (!el) return;
    if (from !== 'end') { try { el.focus(); if (document.activeElement === el) return; } catch (e) { /* fall through */ } }
    var root = el.shadowRoot || el;
    var list = root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    var target = list.length ? list[from === 'end' ? list.length - 1 : 0] : el;
    try { target.focus(); } catch (e) { /* ignore */ }
  }
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent || e.origin !== parentOrigin) return;
    var d = e.data;
    if (!d || d.ut !== 1 || d.channel !== channel || typeof d.type !== 'string') return;
    if (d.type === 'init' || d.type === 'update') {
      apply(d.state);
      if (d.type === 'init' && !initialised) { initialised = true; mount(); }
    }
    else if (d.type === 'focus') focusControl(d.from);
    else if (d.type === 'response' && pending[d.request_id]) {
      var p = pending[d.request_id]; delete pending[d.request_id];
      if (d.ok) p.resolve(d.result); else p.reject(new Error(typeof d.error === 'string' ? d.error : 'Request failed'));
    }
  });
  // Tab past the control's last stop (Shift+Tab before its first) hands focus back to the form.
  function deepActive() { var a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; }
  function tabStops(root, out) {
    var nodes = root.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.tabIndex >= 0 && !n.disabled && n.getAttribute('tabindex') !== '-1' && (n.getClientRects().length || n === el)) {
        if (n !== el || el.getAttribute('tabindex') !== null) out.push(n);
      }
      if (n.shadowRoot) tabStops(n.shadowRoot, out);
    }
    return out;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || e.defaultPrevented || !el) return;
    var stops = tabStops(document, []);
    var active = deepActive();
    var i = stops.indexOf(active);
    if (stops.length === 0 || (e.shiftKey ? i <= 0 : i === -1 || i >= stops.length - 1)) {
      e.preventDefault();
      post({ type: 'focus-exit', direction: e.shiftKey ? 'backward' : 'forward' });
    }
  }, true);
  window.addEventListener('blur', function () { post({ type: 'blur' }); });
  window.addEventListener('focus', function () {
    post({ type: 'focus' });
    // The frame itself got focus (label click, programmatic focus): hand it to the control.
    setTimeout(function () { if (document.activeElement === document.body || !document.activeElement) focusControl('start'); }, 0);
  });
  var timer = setTimeout(function () { if (!el) fail('The control did not define <' + cfg.tag + '>'); }, cfg.defineTimeout);
  customElements.whenDefined(cfg.tag).then(function () { clearTimeout(timer); defined = true; mount(); });
  // Ask for the init state right away (it travels while the module is still being parsed);
  // re-ask briefly in case the host's listener was not attached yet.
  var hellos = 0;
  (function hello() { if (initialised || hellos++ > 20) return; post({ type: 'hello' }); setTimeout(hello, 150); })();
})();`

/**
 * The frame document. `bundle` is the control's ES module (made inline-safe
 * here); the caller hashes the returned `scripts` for the CSP.
 */
export function buildFrameDocument(manifest: Pick<FormControlManifest, 'tag' | 'version' | 'props' | 'name'>, bundle: string): { html: string; scripts: string[] } {
  const runtime = FRAME_RUNTIME
  const moduleSource = inlineScriptSafe(bundle)
  const config = inlineJson(frameConfig(manifest))
  const title = manifest.name.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>
html, body { margin: 0; padding: 0; background: transparent; }
html { color-scheme: light dark; }
body { font-family: var(--ut-font-family, system-ui, sans-serif); font-size: var(--ut-font-size, 14px); color: var(--ut-text, inherit); overflow: hidden; }
#ut-root { padding: 4px; box-sizing: border-box; }
</style>
</head>
<body>
<div id="ut-root"></div>
<script type="application/json" id="ut-config">${config}</script>
<script>${runtime}</script>
<script type="module">${moduleSource}</script>
</body>
</html>`
  return { html, scripts: [runtime, moduleSource] }
}

/** A small error document (unknown / disabled control) under the same CSP rules (no scripts). */
export function frameErrorDocument(message: string): string {
  const safe = message.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Unavailable</title><style>body{margin:0;font:12px system-ui,sans-serif;color:#b42318;padding:6px}</style></head><body><p role="alert">${safe}</p></body></html>`
}
