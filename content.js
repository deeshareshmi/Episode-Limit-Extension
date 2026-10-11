(() => {
  'use strict';
  const detector = new NetflixDetection.NetflixDetector(), sampler = new PlaybackSampler();
  const session = crypto.randomUUID();
  let seq = 0, inFlight = null, attached = null, lastKey = null, status = null, observation = null;
  let host = null, shadow = null, shown = false, lastDiagnostic = 0, choosing = false, pendingPlay = false;
  let pendingNavigation = null, replayControl = null, checkingNavigation = false;
  let originalBodyInert = null;
  const send = async message => {
    const result = await chrome.runtime.sendMessage(message);
    if (result?.error) throw new Error(result.error);
    return result;
  };
  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'netflix-daily-pause';
    // Put the overlay inside the fullscreen element when Netflix uses fullscreen.
    (document.fullscreenElement || document.documentElement).append(host);
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host{all:initial} [hidden]{display:none!important} .backdrop{position:fixed;inset:0;z-index:2147483647;background:#080b14dc;display:grid;place-items:center;color:#f7f8fc;font:16px/1.5 system-ui}
      .card{box-sizing:border-box;background:#151c2b;border:1px solid #627089;border-radius:16px;padding:28px;width:min(480px,90vw);box-shadow:0 20px 80px #000}
      .card{max-height:90vh;overflow:auto} h2{font-size:25px;margin:0 0 12px} p{white-space:pre-wrap;overflow-wrap:anywhere} button{display:block;width:100%;padding:12px;margin-top:10px;border:1px solid #8b9ab3;border-radius:8px;background:#26334b;color:white;font:inherit;cursor:pointer}button:first-of-type{background:#c83144}button:focus-visible,textarea:focus-visible,input:focus-visible{outline:3px solid #a9ccff}button:disabled{opacity:.5;cursor:default} .small{font-size:13px;color:#bcc8da} label{display:block;margin:12px 0;font-size:14px}textarea{box-sizing:border-box;width:100%;margin-top:6px;padding:8px;background:#0b111d;border:1px solid #8b9ab3;color:white;font:inherit;border-radius:6px}
      </style><div class="backdrop"><section class="card" role="dialog" aria-modal="true" aria-labelledby="pause-title"><h2 id="pause-title">Time for a pause</h2><p id="summary"></p><p id="reason"></p><p class="small" id="note"></p><label id="extension-reason-label" hidden>Type exactly: <strong>I want to watch one more episode</strong><textarea id="extension-reason" maxlength="100" rows="2" autocomplete="off" spellcheck="false"></textarea></label><button data-choice="stop">Stop for today</button><button data-choice="episode" hidden>Watch another episode</button></section></div>`;
    shadow.addEventListener('input', updateButtons);
    shadow.addEventListener('click', async event => {
      const choice = event.target.dataset.choice;
      if (!choice || choosing || !status) return;
      choosing = true;
      try {
        const navigation = pendingNavigation;
        status = await send({ type: 'choice', session, choice, date: status.date, revision: status.revision, item: status.item, context: status.context, reason: shadow.querySelector('#extension-reason').value });
        if (!status.blocked) {
          hide(); sampler.reset();
          pendingNavigation = null;
          if (navigation && navigation.key === NetflixDetection.watchKey() && navigation.control.isConnected) replay(navigation.control);
          else if (!observation.video?.ended) await observation.video?.play().catch(() => {});
        } else show(status);
      } catch (error) { if (shadow && host) shadow.querySelector('#note').textContent = `Could not save choice: ${error.message}`; }
      finally { choosing = false; }
    });
    shadow.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const buttons = [...shadow.querySelectorAll('button,input,textarea')].filter(b => !b.hidden && !b.closest('[hidden]') && !b.disabled);
      const index = buttons.indexOf(shadow.activeElement);
      if (buttons.length) { event.preventDefault(); buttons[(index+(event.shiftKey ? -1 : 1)+buttons.length)%buttons.length].focus(); }
    });
  }
  function setSiteLock(locked) {
    if(locked){
      for(const video of document.querySelectorAll('video'))video.pause();
      if(document.body&&originalBodyInert===null){originalBodyInert=document.body.inert;document.body.inert=true;}
    }else if(originalBodyInert!==null&&document.body){document.body.inert=originalBodyInert;originalBodyInert=null;}
  }
  function hide() { host?.remove(); host = null; shown = false; setSiteLock(false); }
  function updateButtons() {
    if (!host || !status) return;
    const seconds=Math.ceil(status.friction.waitMs/1000),wait=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    const button=shadow.querySelector('[data-choice="episode"]');
    const ready=status.friction.waitMs===0 && (!status.friction.reasonRequired || shadow.querySelector('#extension-reason').value.trim()===status.friction.phrase);
    button.textContent=seconds?`Watch another episode (${wait})`:'Watch another episode';
    button.disabled=!ready;
  }
  function show(result) {
    mount();
    setSiteLock(result.today.stopped);
    const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
    shadow.querySelector('#pause-title').textContent=result.today.stopped?'Netflix is locked for today':'Stop now or watch one more episode?';
    shadow.querySelector('#summary').textContent = `Your plan: ${plural(result.settings.episodes,'episode')} and ${plural(result.settings.minutes,'minute')}.\nToday: ${plural(result.count,'identified episode')} counted and ${(result.today.ms/60000).toFixed(1)} playback minutes.`;
    shadow.querySelector('#reason').textContent = result.settings.reason ? `Your reason to stop: “${result.settings.reason}”` : '';
    const explanations={episodes:'You have reached your daily episode allowance.',minutes:'You have reached your daily playback-minute limit. Continuing permits this episode to finish.', 'extra-episode-finished':'Your extra episode has finished, or you are moving to another video.','other-video':'Your extra episode is already open in another tab. Continue that episode there, or stop for today.',stopped:result.today.lockReason==='allowances-used'?'Both extra episodes have been used. All Netflix pages are blocked until local midnight.':'You chose to stop. All Netflix pages are blocked until local midnight.'};
    const unknown=result.action&&result.item.kind==='unknown'?' The title is unavailable, but you can still continue. Permission follows this Netflix watch page; no episode title or number will be invented.':'';
    shadow.querySelector('#note').textContent=result.notice||(explanations[result.cause]||'')+unknown;
    shadow.querySelector('#extension-reason-label').hidden=!result.action||!result.friction.reasonRequired;
    shadow.querySelector('[data-choice="episode"]').hidden = result.action!=='episode';
    shadow.querySelector('[data-choice="stop"]').disabled = result.today.stopped;
    updateButtons();
    if (!shown) { shadow.querySelector('button:not([hidden]):not(:disabled)')?.focus(); shown = true; }
  }
  function attach(video) {
    if (attached === video) return;
    if (attached) for (const e of ['play','pause','seeking','seeked','ended','waiting','playing','timeupdate','loadedmetadata']) attached.removeEventListener(e,onMedia);
    attached = video; sampler.reset();
    if (video) for (const e of ['play','pause','seeking','seeked','ended','waiting','playing','timeupdate','loadedmetadata']) video.addEventListener(e,onMedia);
  }
  function onMedia(event) {
    if (event.type === 'timeupdate') {
      if (NetflixDetection.watchKey() === lastKey) return;
      pendingPlay = !attached.paused;
      attached.pause();
    }
    if (event.type === 'seeking' || event.type === 'seeked' || event.type === 'waiting') sampler.reset();
    if (event.type === 'play') {
      const next = detector.observe();
      if (next.key !== lastKey || !status) { pendingPlay = true; attached.pause(); }
      else if (status.blocked) attached.pause();
    }
    void pulse();
  }
  function pulse() {
    if (choosing) return Promise.resolve();
    if (!inFlight) inFlight = Promise.resolve().then(runPulse).finally(() => { inFlight = null; });
    return inFlight;
  }
  async function runPulse() {
    try {
      observation = detector.observe();
      const { video, key, eligible, item } = observation;
      attach(video);
      if (!eligible) {
        sampler.reset(); lastKey = null;
        status = await send({ type: 'get' });
        if(status.blocked)show(status);else hide();
        if (Date.now()-lastDiagnostic > 5000) {
          lastDiagnostic = Date.now();
          if (status.settings.diagnostic) await send({ type: 'diagnostic', observation: { ...observation.diagnostic, ...NetflixDetection.diagnosticContext(), extensionVersion: chrome.runtime.getManifest().version } });
        }
        return;
      }
      const ms = sampler.sample({ key, now: performance.now(), position: video.currentTime, rate: video.playbackRate || 1, playing: !video.paused && !video.ended && video.readyState >= 2, seeking: video.seeking, eligible });
      const transition = key !== lastKey;
      let resumeAfterGate = (transition && !video.paused) || pendingPlay;
      pendingPlay = false;
      if (transition) { video.pause(); sampler.reset(); lastKey = key; }
      const attempt=resumeAfterGate||!video.paused||(transition&&document.visibilityState==='visible'&&document.hasFocus());
      status = await send({ type: 'tick', session, seq: ++seq, ms, item, watchId:key, ended:video.ended, attempt });
      // A reply about the old video must never resume a newly navigated player.
      if (NetflixDetection.watchKey() !== key) { video.pause(); sampler.reset(); return; }
      if (pendingNavigation?.key === key) status = await send({ type: 'navigation', session, targetId: pendingNavigation.watchId, item:status.item, watchId:key });
      else if (pendingNavigation) pendingNavigation = null;
      if (status.blocked) { video.pause(); sampler.reset(); show(status); }
      else { hide(); if (resumeAfterGate) await video.play().catch(() => {}); }
      if (status.settings.diagnostic && Date.now()-lastDiagnostic > 5000) {
        lastDiagnostic = Date.now();
        await send({ type: 'diagnostic', observation: { ...observation.diagnostic, ...NetflixDetection.diagnosticContext(), effectiveIdentity:status.item, blockReason:status.cause, extensionVersion: chrome.runtime.getManifest().version, paused: video.paused, seeking: video.seeking, position: video.currentTime, lastSampleMs: ms } });
      }
    } catch (error) {
      // A broken extension must not silently leave playback running without limits.
      attached?.pause();
      console.warn('[Netflix Daily Pause] Reload the tab if the extension was updated.', error);
    }
  }
  function replay(control) {
    replayControl = control;
    try { control.click(); } finally { replayControl = null; }
  }
  document.addEventListener('click', event => {
    const target = NetflixDetection.navigationTarget(event.target);
    if (!target || target.control === replayControl) return;
    // Stop Netflix's handler synchronously; release only after the worker has
    // checked the latest totals (including playback in another Netflix tab).
    event.preventDefault(); event.stopImmediatePropagation();
    if (checkingNavigation || choosing) return;
    checkingNavigation = true;
    void (async () => {
      try {
        const key = NetflixDetection.watchKey();
        await pulse();
        const result = await send({ type: 'navigation', session, targetId: target.watchId, item:status.item, watchId:key });
        if (key !== NetflixDetection.watchKey()) return;
        status = result;
        if (result.blocked) {
          pendingNavigation = { ...target, key };
          attached?.pause(); sampler.reset(); show(result);
        } else if (target.control.isConnected) replay(target.control);
      } catch (error) { attached?.pause(); console.warn('[Netflix Daily Pause] Could not check next episode.',error); }
      finally { checkingNavigation = false; }
    })();
  },true);
  window.addEventListener('popstate', () => { void pulse(); });
  window.addEventListener('pageshow', () => { void pulse(); });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void pulse();});
  document.addEventListener('play',event=>{if(status?.today.stopped&&event.target instanceof HTMLMediaElement)event.target.pause();},true);
  chrome.storage?.onChanged?.addListener((changes,area)=>{
    if(area==='local'&&changes.state){
      const {oldValue,newValue}=changes.state,next=newValue?.days?.[LimitEngine.dayKey(Date.now())];
      if(!!next?.stopped!==!!status?.today.stopped||JSON.stringify(oldValue?.settings)!==JSON.stringify(newValue?.settings))void pulse();
    }
  });
  NetflixDetection.watchMetadata(() => { void pulse(); });
  document.addEventListener('fullscreenchange', () => { if (host) (document.fullscreenElement || document.documentElement).append(host); });
  setInterval(pulse,1000);
  void pulse();
})();
