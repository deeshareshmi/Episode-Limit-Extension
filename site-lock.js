/* One persistent, Netflix-only navigation rule. No browsing-history access. */
(function(g){
  const RULE_ID=1,ALARM='netflix-daily-unlock';
  function nextMidnight(now){const date=new Date(now);date.setHours(24,0,0,0);return date.getTime();}
  async function sync(chrome,state,now){
    const locked=LimitEngine.day(state,now).stopped;
    const rules=await chrome.declarativeNetRequest.getDynamicRules();
    const present=rules.some(rule=>rule.id===RULE_ID);
    if(locked!==present)await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[RULE_ID],addRules:locked?[{id:RULE_ID,priority:1,action:{type:'block'},condition:{requestDomains:['netflix.com'],resourceTypes:['main_frame']}}]:[]});
    if(locked){
      const alarm=await chrome.alarms.get(ALARM),when=nextMidnight(now);
      if(!alarm||alarm.scheduledTime!==when)await chrome.alarms.create(ALARM,{when});
    }else await chrome.alarms.clear(ALARM);
    return locked;
  }
  g.NetflixSiteLock={sync,ALARM,nextMidnight};
})(globalThis);
