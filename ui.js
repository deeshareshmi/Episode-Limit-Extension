/* Shared local views. Only the background worker writes settings or viewing state. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  async function send(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result || result.error) throw new Error(result?.error || 'Could not reach the extension. Reload this page.');
    return result;
  }
  function settingsForm(onSaved = () => {}) {
    const fields = { episodes: $('episode-limit'), minutes: $('minute-limit'), reason: $('reason'), diagnostic: $('diagnostic') };
    const dirty = new Set(), versions = {};
    let latest = null, saving = false;
    const value = key => key === 'diagnostic' ? fields[key].checked : ['episodes','minutes'].includes(key) ? Number(fields[key].value) : fields[key].value;
    function update(settings) {
      latest = settings;
      for (const [key,field] of Object.entries(fields)) if (!dirty.has(key)) {
        if (key === 'diagnostic') field.checked = settings[key]; else field.value = settings[key];
      }
    }
    for (const [key,field] of Object.entries(fields)) field.addEventListener('input', () => {
      versions[key] = (versions[key] || 0) + 1;
      if (latest && value(key) === latest[key]) dirty.delete(key); else dirty.add(key);
      $('status').textContent = dirty.size ? 'Unsaved changes.' : '';
    });
    $('settings').addEventListener('submit', async event => {
      event.preventDefault();
      if (saving || !latest || !$('settings').reportValidity()) return;
      const patch = Object.fromEntries([...dirty].map(key => [key,value(key)])), submitted = {...versions};
      const button = $('settings').querySelector('[type="submit"]');
      saving = true; button.disabled = true;
      try {
        const result = await send({type:'settings',settings:patch});
        for (const key of Object.keys(patch)) if (versions[key] === submitted[key]) dirty.delete(key);
        update(result.settings);
        $('status').textContent = dirty.size ? 'Saved. You have additional unsaved changes.' : 'Settings saved.';
        onSaved(result);
      } catch (error) { $('status').textContent = error.message; }
      finally { saving = false; button.disabled = false; }
    });
    return {update};
  }
  function watch(render) {
    let pending = null, date = '', signature = '';
    function publish(result) {
      date = result.date;
      const next = JSON.stringify([result.settings,result.today,result.date]);
      if (signature !== next) { signature = next; render(result); }
    }
    function refresh() {
      if (!pending) pending = send({type:'get'}).then(publish).catch(error => { $('status').textContent = error.message; }).finally(() => {pending=null;});
      return pending;
    }
    chrome.storage.onChanged.addListener((changes,area) => {
      if (area !== 'local' || !changes.state) return;
      const state = changes.state.newValue, today = state?.days?.[LimitEngine.dayKey(Date.now())];
      if (!today) { void refresh(); return; }
      publish({settings:state.settings,today,date:LimitEngine.dayKey(Date.now()),count:LimitEngine.count(today)});
    });
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => {if(!document.hidden)void refresh();});
    setInterval(() => {if(date !== LimitEngine.dayKey(Date.now()))void refresh();},1000);
    void refresh();
    return refresh;
  }
  function renderLog(list, episodes, empty = 'No confidently identified episodes today.') {
    list.replaceChildren();
    for (const e of episodes) {
      const li = document.createElement('li'), small = document.createElement('small');
      const number = [e.season ? `S${e.season}` : '',e.episode ? `E${e.episode}` : ''].filter(Boolean).join(' ');
      li.textContent = `${e.title}${number ? ` · ${number}` : ' · Episode'}${e.episodeTitle ? ` · ${e.episodeTitle}` : ''}`;
      small.textContent = `${(e.ms/60000).toFixed(1)} min · ${e.ms >= LimitEngine.MEANINGFUL_MS ? (e.completed ? 'Counted · reached end' : 'Counted') : 'Not counted yet'}`;
      li.append(small); list.append(li);
    }
    if (!episodes.length) { const li = document.createElement('li'); li.className='empty'; li.textContent=empty; list.append(li); }
  }
  function totals(result) {
    $('episodes').textContent = result.count;
    $('minutes').textContent = (result.today.ms/60000).toFixed(1);
    $('allowance').textContent = result.today.stopped ? 'Netflix is locked until local midnight.' : '';
    $('allowance').hidden = !result.today.stopped;
  }
  async function diagnostics() {
    try {
      const {diagnostic} = await chrome.storage.local.get('diagnostic');
      $('observation').textContent = diagnostic ? JSON.stringify(diagnostic,null,2) : 'Enable detector diagnostics, save, then play Netflix and reveal its controls.';
    } catch (error) { $('observation').textContent = error.message; }
  }
  function dateObject(key) { const [y,m,d]=key.split('-').map(Number); return new Date(y,m-1,d,12); }
  function dateLabel(key) { return dateObject(key).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); }
  function rangeDates(today,length) {
    return Array.from({length},(_,i)=>{const d=dateObject(today);d.setDate(d.getDate()-(length-1-i));return LimitEngine.dayKey(d.getTime());});
  }
  window.DailyPauseUI = {$,send,settingsForm,watch,renderLog,totals,diagnostics,dateLabel,dateObject,rangeDates};
})();
