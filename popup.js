'use strict';
const {$,settingsForm,watch,renderLog,totals,diagnostics} = DailyPauseUI;
const form = settingsForm();
watch(result => {
  form.update(result.settings); totals(result);
  renderLog($('log'),Object.values(result.today.episodes));
  $('diagnostics').hidden = !result.settings.diagnostic;
  if(result.settings.diagnostic)void diagnostics();
});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.diagnostic)void diagnostics();});
$('open-guide').addEventListener('click',async()=>{
  try { await chrome.runtime.openOptionsPage(); }
  catch(error) { $('status').textContent=error.message; }
});
