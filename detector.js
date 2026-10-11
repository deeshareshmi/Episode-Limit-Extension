/* Netflix-specific DOM assumptions live here. No private APIs or guessed episodes. */
(function (g) {
  'use strict';
  const PLAYER = '.watch-video, [data-uia="watch-video"]';
  const TITLES = ['[data-uia="video-title"]', '.video-title', '[data-uia="player-title"]', '.watch-video--title'];
  const EPISODES = '[data-uia="control-episodes"], [data-uia="control-episode-selector"], [data-uia="episode-selector"]';
  const NEXT = '[data-uia="control-next"], [data-uia="next-episode-seamless-button"], [data-uia="next-episode-seamless-button-draining"], [data-uia="next-episode"]';
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
  const query = (node, selector) => node?.querySelector(selector) || null;
  const all = (node, selector) => [...(node?.querySelectorAll?.(selector) || [])];
  // textContent joins sibling elements without spaces ("ShowS1:E2Title").
  function parts(node) {
    if (!node) return '';
    if (!node.childNodes?.length) return clean(node.textContent);
    return clean([...node.childNodes].map(child => child.nodeType === 3 ? child.textContent : parts(child)).join(' '));
  }
  function episodeLabel(detail) {
    const full = detail.match(/\bS(?:eason)?\s*(\d+)\s*[:.,·/–—-]?\s*(?:E(?:p(?:isode)?)?\.?)\s*(\d+)\b/i);
    if (full) return { season: Number(full[1]), episode: Number(full[2]), match: full };
    const ep = detail.match(/\b(?:Episode|Ep\.?|E)\s*(\d+)\b/i);
    if (ep) return { season: null, episode: Number(ep[1]), match: ep };
    return null;
  }
  function classify({ watchId, title, detail = '', preview, seriesControl = false }) {
    if (preview) return { kind: 'preview' };
    if (!watchId || !title) return { kind: 'unknown' };
    // Do not parse episode words inside a movie/show title as episode metadata.
    const metadata = clean(detail).startsWith(clean(title)) ? clean(detail).slice(clean(title).length).trim() : clean(detail);
    const label = episodeLabel(metadata);
    if (!label && !seriesControl) return { kind: 'unknown' };
    return { kind: 'episode', id: watchId, title, season: label?.season || null,
      episode: label?.episode || null,
      episodeTitle: label ? metadata.slice(label.match.index+label.match[0].length).replace(/^[\s:·–—-]+/,'') : '',
      evidence: label ? 'episode-label' : 'episode-selector' };
  }
  function navigationTarget(target) {
    const control = target?.closest?.(`${NEXT}, button, a, [role="button"]`);
    if (!control?.closest(PLAYER)) return null;
    const link = control.closest('a[href*="/watch/"]');
    const watchId = link?.getAttribute('href')?.match(/\/watch\/(\d+)/)?.[1] || null;
    const label = clean(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent);
    if (watchId || control.matches(NEXT) || /\bnext episode\b/i.test(label)) return { control, watchId };
    return null;
  }
  const watchKey = (loc = location) => loc.pathname.match(/^\/watch\/(\d+)/)?.[1] || 'outside-watch';
  class NetflixDetector {
    constructor() { this.watchId = null; this.signature = ''; this.stable = 0; this.cached = null; this.previousItem = null; this.priorSignature = ''; this.waitFresh = false; }
    observe(doc = document, loc = location) {
      const watchId = loc.pathname.match(/^\/watch\/(\d+)/)?.[1] || null;
      const player = query(doc,PLAYER);
      const video = all(player,'video').sort((a,b) => b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0] || null;
      // Some player layouts mount their controls outside the video container.
      // Only player-specific selectors may cross that container boundary.
      const seriesControl = !!(query(player,EPISODES) || (watchId && video && query(doc,EPISODES))) || all(player,'button[aria-label]').some(el => /^(?:episodes|episode selector|seasons and episodes)$/i.test(clean(el.getAttribute('aria-label'))));
      const candidates = TITLES.map(selector => {
        const local = query(player,selector);
        const element = local || (watchId && video ? query(doc,selector) : null), detail = parts(element);
        let title = parts(query(element,'h4, h3, h2, [data-uia="title"], .title'));
        if (!title && detail) {
          const label = episodeLabel(detail);
          const separateLabel = all(element,'span, p, div').some(el => parts(el) !== detail && episodeLabel(parts(el)));
          // "Movie Episode 1" in a single title node is not episode evidence.
          const usable = label && (label.season || seriesControl || separateLabel);
          title = usable ? detail.slice(0,label.match.index).replace(/[\s:·|–—-]+$/,'') : detail;
        }
        return { selector, scope:local?'video-container':'player-controls', title, detail };
      }).filter(c => c.detail);
      const previewMarker = !!query(player,'[data-uia="preview-player"], [data-uia="trailer-player"]');
      const selected = candidates.find(c => classify({watchId, ...c, seriesControl}).kind === 'episode') || candidates[0] || { title: '', detail: '', selector: null };
      const { title, detail } = selected;
      const preview = previewMarker || /\b(trailer|teaser|preview)\b/i.test(detail);
      const signature = `${title}|${detail}|${seriesControl}`;
      const transition = watchId !== this.watchId;
      if (transition) {
        this.priorSignature = this.signature; this.previousItem = this.cached;
        this.waitFresh = !!this.watchId;
        this.watchId = watchId; this.cached = null; this.stable = 0;
      }
      this.stable = signature === this.signature ? this.stable+1 : 0;
      this.signature = signature;
      let item = classify({ watchId, title, detail, preview, seriesControl });
      // A blank controls frame must not make an old label fresh on a new URL.
      if (this.waitFresh && item.kind === 'episode' && detail && signature !== this.priorSignature) {
        const old = this.previousItem;
        if (!old || item.title !== old.title || item.episode !== old.episode || item.season !== old.season || item.episodeTitle !== old.episodeTitle) this.waitFresh = false;
      }
      // The watch ID and a series-only selector can identify an episode even when
      // Netflix omits its number. No season/episode number is fabricated.
      if (this.waitFresh && item.kind === 'episode' && !item.episode && seriesControl) this.waitFresh = false;
      let reason = preview ? 'Preview/trailer marker' : !watchId ? 'Not a watch URL' : !video ? 'Main video not found' : !title ? 'Player title not found' : item.kind !== 'episode' ? 'No episode label or episode-selector control' : this.waitFresh ? 'Waiting for the new episode metadata' : this.stable < 1 ? 'Waiting for stable player metadata' : 'Episode identified';
      if (item.kind === 'episode' && (this.stable < 1 || this.waitFresh)) item = { kind: 'unknown' };
      if (item.kind === 'episode') this.cached = item;
      if (!preview && this.cached && (!detail || item.kind === 'unknown')) { item = this.cached; reason = 'Cached identity for this watch ID'; }
      return { video, item, key: watchId || 'outside-watch', eligible: !!watchId && !!video && !preview,
        diagnostic: { watchId, mainPlayerFound: !!player, videoFound: !!video, title, detail, candidates, seriesControl, preview, transition, stable: this.stable, waitingForFreshMetadata: this.waitFresh, classification: item.kind, identity: item, reason, selectors: { player: PLAYER, title: selected.selector, episodeSelector: EPISODES }, controls: all(player,'[data-uia], button[aria-label]').map(el => ({ uia: el.getAttribute('data-uia'), label: el.getAttribute('aria-label') })).filter(el => /episode|next|title/i.test(`${el.uia} ${el.label}`)).slice(0,20) } };
    }
  }
  function diagnosticContext(doc = document) {
    const player = query(doc,PLAYER);
    return { pageTitle: doc.title,
      playerText: clean(player?.innerText).slice(0,1800),
      titleLabels: all(doc,'[data-uia]').filter(el => /title|episode/i.test(el.getAttribute('data-uia'))).slice(0,30).map(el => ({ uia:el.getAttribute('data-uia'),text:parts(el).slice(0,240) })) };
  }
  function watchMetadata(callback, doc = document) {
    const selectors = [...TITLES, EPISODES].join(',');
    let timer;
    const observer = new MutationObserver(records => {
      if (!records.some(record => record.target.parentElement?.closest(selectors) || record.target.closest?.(selectors) || [...record.addedNodes].some(node => node.matches?.(`${selectors}, ${PLAYER}, video`) || node.querySelector?.(selectors)))) return;
      clearTimeout(timer); timer = setTimeout(callback,80);
    });
    observer.observe(doc.documentElement,{subtree:true,childList:true,characterData:true});
    return observer;
  }
  g.NetflixDetection = { NetflixDetector, classify, episodeLabel, navigationTarget, watchKey, diagnosticContext, watchMetadata };
})(globalThis);
