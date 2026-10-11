importScripts('engine.js','site-lock.js');
let queue = Promise.resolve();
function enqueue(task){queue=queue.catch(()=>{}).then(task);return queue;}
async function restoreLock(){
  const state=(await chrome.storage.local.get('state')).state||LimitEngine.fresh();
  LimitEngine.day(state,Date.now());
  await chrome.storage.local.set({state});
  await NetflixSiteLock.sync(chrome,state,Date.now());
}
chrome.runtime.onStartup.addListener(()=>{void enqueue(restoreLock).catch(console.error);});
chrome.runtime.onInstalled.addListener(details=>{void enqueue(async()=>{
  await restoreLock();
  if(details.reason==='install')await chrome.tabs.create({url:chrome.runtime.getURL('options.html#welcome')});
}).catch(console.error);});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===NetflixSiteLock.ALARM)void enqueue(restoreLock).catch(console.error);});
// Re-create a missing midnight alarm whenever an idle worker is restarted.
void enqueue(restoreLock).catch(console.error);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!['tick','get','settings','history','choice','diagnostic','navigation'].includes(message?.type)) return false;
  const pending=enqueue(async () => {
    const state = (await chrome.storage.local.get('state')).state || LimitEngine.fresh();
    const now = Date.now();
    if(message.type==='history')return {today:LimitEngine.dayKey(now),days:Object.keys(state.days).sort().reverse().slice(0,90).map(date=>{
      const d=state.days[date];
      return {date,ms:d.ms,count:LimitEngine.count(d),episodes:Object.values(d.episodes)};
    })};
    let result;
    if (message.type === 'tick') {
      const url=new URL(sender.url||'https://invalid.local');
      if (!sender.tab || !['http:','https:'].includes(url.protocol) || !(url.hostname==='netflix.com'||url.hostname.endsWith('.netflix.com'))) throw new Error('Netflix tab required');
      result = LimitEngine.tick(state, `${sender.tab.id}:${message.session}`, message, now);
    } else if (message.type === 'navigation') result = LimitEngine.navigationVerdict(state,message.targetId,now,message.item,message.watchId,`${sender.tab?.id}:${message.session}`);
    else if (message.type === 'choice') result = LimitEngine.choose(state, message, now);
    else if (message.type === 'settings') {
      if(!message.settings||typeof message.settings!=='object'||Array.isArray(message.settings))throw new Error('Invalid settings.');
      const patch={};
      for(const key of ['episodes','minutes','reason','diagnostic'])if(Object.hasOwn(message.settings,key))patch[key]=message.settings[key];
      const s = {...state.settings,...patch};
      if (!Number.isInteger(s.episodes) || s.episodes < 1 || s.episodes > 100 || !Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > 1440) throw new Error('Enter 1–100 episodes and 1–1440 minutes.');
      state.settings = { episodes: s.episodes, minutes: s.minutes, reason: String(s.reason || '').trim().slice(0,240), diagnostic: !!s.diagnostic };
      const d = LimitEngine.day(state,now); d.revision++;
      result = LimitEngine.verdict(state,null,now,{mode:'summary'});
    } else if (message.type === 'diagnostic') {
      if (state.settings.diagnostic) await chrome.storage.local.set({ diagnostic: { ...message.observation, observedAt: new Date(now).toISOString(), tabId: sender.tab?.id } });
      return { ok: true };
    } else result = LimitEngine.verdict(state,null,now,{mode:'summary'});
    await chrome.storage.local.set({ state });
    await NetflixSiteLock.sync(chrome,state,now);
    return result;
  });
  pending.then(reply, error => reply({ error: error.message }));
  return true;
});
