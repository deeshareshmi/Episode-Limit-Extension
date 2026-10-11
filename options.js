'use strict';
const {$,send,settingsForm,watch,renderLog,totals,diagnostics,dateLabel,dateObject,rangeDates} = DailyPauseUI;
const episodesText=count=>`${count} episode${count===1?'':'s'}`;
let history = {today:LimitEngine.dayKey(Date.now()),days:[]}, range = 7, selected = history.today;
let historyPending = null, historyTimer = null, historySignature = '', followToday = true;
function welcomeMode() {
  const welcome = location.hash === '#welcome';
  document.body.classList.toggle('welcoming',welcome); $('welcome').hidden = !welcome;
  const section = welcome ? '#limits' : location.hash || '#today';
  for(const link of document.querySelectorAll('nav a')) {
    if(link.getAttribute('href')===section)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
  }
}
welcomeMode(); window.addEventListener('hashchange',welcomeMode);
const form = settingsForm(() => {
  if(location.hash==='#welcome') {
    window.history.replaceState(null,'','#limits'); welcomeMode(); $('limits').scrollIntoView();
  }
});
$('version').textContent = `v${chrome.runtime.getManifest().version}`;
function select(date) { selected=date; followToday=date===history.today; paintSelection(); }
function paintChart(id,metric) {
  const chart=$(id),dates=rangeDates(history.today,range),byDate=new Map(history.days.map(day=>[day.date,day]));
  const value=day=>metric==='ms'?day.ms/60000:day.count;
  const maximum=Math.max(1,...dates.map(date=>byDate.has(date)?value(byDate.get(date)):0));
  const scale=metric==='ms'?Math.ceil(maximum):maximum;
  $(metric==='ms'?'minutes-scale':'episodes-scale').textContent=`0–${scale}${metric==='ms'?' min':''}`;
  chart.style.setProperty('--days',range); chart.classList.toggle('episode-bars',metric==='count');
  const keys=dates.join(',');
  if(chart.dataset.dates!==keys){
    chart.dataset.dates=keys; chart.replaceChildren();
    for(const date of dates){
      const button=document.createElement('button'),track=document.createElement('span'),fill=document.createElement('span'),label=document.createElement('span');
      button.type='button';button.className='bar-button';button.dataset.date=date;
      track.className='bar-track';track.setAttribute('aria-hidden','true');fill.className='bar-fill';label.className='bar-day';label.textContent=dateObject(date).getDate();
      track.append(fill);button.append(track,label);button.addEventListener('click',()=>select(date));chart.append(button);
    }
  }
  for(const button of chart.children){
    const day=byDate.get(button.dataset.date),amount=day?value(day):0;
    button.classList.toggle('missing',!day);button.classList.toggle('zero',!!day&&amount===0);
    button.style.setProperty('--height',`${amount/scale*100}%`);
    const description=`${dateLabel(button.dataset.date)}: ${day?(metric==='ms'?`${amount.toFixed(1)} minutes played`:`${episodesText(amount)} counted`):'No recorded data'}. Select to view episode log.`;
    button.setAttribute('aria-label',description);button.title=description;
  }
}
function paintDays(){
  const list=$('day-list'),keys=history.days.map(day=>day.date).join(',');
  if(list.dataset.dates!==keys){
    list.dataset.dates=keys;list.replaceChildren();
    for(const day of history.days){
      const li=document.createElement('li'),button=document.createElement('button');
      button.type='button';button.dataset.date=day.date;button.addEventListener('click',()=>select(day.date));li.append(button);list.append(li);
    }
    if(!history.days.length){const li=document.createElement('li');li.textContent='No recorded days yet.';list.append(li);}
  }
  for(const day of history.days){
    const button=list.querySelector(`[data-date="${day.date}"]`),small=document.createElement('small');
    button.textContent=dateLabel(day.date);small.textContent=`${episodesText(day.count)} · ${(day.ms/60000).toFixed(1)} min`;button.append(small);
  }
}
function paintSelection(){
  for(const button of document.querySelectorAll('[data-date]'))button.setAttribute('aria-pressed',String(button.dataset.date===selected));
  $('selected-date').textContent=dateLabel(selected);
  const day=history.days.find(day=>day.date===selected);
  $('selected-summary').textContent=day?`${episodesText(day.count)} counted · ${(day.ms/60000).toFixed(1)} minutes played`:'No recorded data for this day.';
  renderLog($('history-log'),day?.episodes||[],day?'No confidently identified episodes on this day.':'No episode log is available.');
}
function paintHistory(){
  const dates=rangeDates(history.today,range);
  $('history-status').textContent=`${dateLabel(dates[0])} – ${dateLabel(history.today)}`;
  paintChart('minutes-chart','ms');paintChart('episodes-chart','count');paintDays();paintSelection();
}
async function refreshHistory(){
  if(historyPending)return historyPending;
  historyPending=send({type:'history'}).then(result=>{
    const signature=JSON.stringify(result);if(signature===historySignature)return;
    historySignature=signature;history=result;if(followToday)selected=history.today;paintHistory();
  }).catch(error=>{$('history-status').textContent=error.message;}).finally(()=>{historyPending=null;});
  return historyPending;
}
function scheduleHistory(){clearTimeout(historyTimer);historyTimer=setTimeout(()=>{void refreshHistory();},100);}
for(const button of document.querySelectorAll('[data-range]'))button.addEventListener('click',()=>{
  range=Number(button.dataset.range);
  for(const option of document.querySelectorAll('[data-range]'))option.setAttribute('aria-pressed',String(option===button));
  paintHistory();
});
watch(result=>{
  form.update(result.settings);totals(result);$('today-date').textContent=dateLabel(result.date);
  renderLog($('log'),Object.values(result.today.episodes));scheduleHistory();
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  if(changes.diagnostic)void diagnostics();
  if(changes.state)scheduleHistory();
});
$('troubleshooting').addEventListener('toggle',()=>{if($('troubleshooting').open)void diagnostics();});
