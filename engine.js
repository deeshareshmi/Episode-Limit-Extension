/* Daily policy. Episode metadata is for logging; watch IDs enforce allowances. */
(function(g){
  'use strict';
  const MEANINGFUL_MS=300000,DELAYS=[60000,300000],PHRASE='I want to watch one more episode';
  const dayKey=time=>{const d=new Date(time);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const fresh=()=>({settings:{episodes:2,minutes:90,reason:'',diagnostic:false},days:{},sessions:{}});
  function lock(d,reason){d.stopped=true;d.phase='locked';d.lockReason=reason;d.offer=null;d.allowance=null;d.revision++;}
  function day(state,now){
    const d=state.days[dayKey(now)] ||= {ms:0,episodes:{},stopped:false,revision:0};
    if(d.policyVersion!==4){
      d.extensionsUsed=Math.min(2,d.extensionsUsed??(d.override?1:0));
      d.extensionHistory ||= [];
      const last=d.episodeGrants?.at(-1);
      d.phase=d.stopped?'locked':'normal';d.allowance=null;d.offer=null;
      if(!d.stopped&&last&&d.extensionsUsed)d.allowance={id:last.id||null,after:last.after||null,owner:null};
      if(d.allowance)d.phase='allowance';
      if(d.allowance?.id&&d.episodes[d.allowance.id]?.completed)offer(d,'extra-episode-finished',{mode:'ended',watchId:d.allowance.id},{id:d.allowance.id},now);
      if(!d.stopped&&d.extensionsUsed===2&&!d.allowance)lock(d,'allowances-used');
      delete d.override;delete d.episodeGrants;delete d.extraMs;delete d.cooldown;
      d.policyVersion=4;d.revision++;
    }
    return d;
  }
  const count=d=>Object.values(d.episodes).filter(e=>e.ms>=MEANINGFUL_MS).length;
  function resolveItem(state,item,id){
    if(['episode','movie','preview'].includes(item?.kind))return item;
    if(id)for(const key of Object.keys(state.days).sort().reverse()){
      const e=state.days[key].episodes[id];if(e?.title)return {...e,kind:'episode',evidence:'saved-watch-identity'};
    }
    return {kind:'unknown'};
  }
  const baseAllowed=(d,id,s)=>!!(d.episodes[id]?.ms>=MEANINGFUL_MS&&d.episodes[id].allowed!==false)||count(d)<s.episodes;
  function offer(d,cause,context,item,now){
    if(d.extensionsUsed>=2){lock(d,'allowances-used');return;}
    const boundary=context.mode==='next'||context.mode==='ended',id=context.watchId||item.id||null;
    d.phase='offer';d.allowance=null;
    d.offer={cause,readyAt:now+DELAYS[d.extensionsUsed],scopeId:boundary?(context.targetId||null):id,after:boundary?id:null};
    d.revision++;
  }
  function verdict(state,raw,now,context={}){
    const d=day(state,now),s=state.settings,mode=context.mode||'play';
    const item=resolveItem(state,raw,context.watchId),id=context.watchId||item.id||null;
    const boundary=mode==='next'||mode==='ended';
    let otherVideo=false;
    if(!d.stopped&&mode!=='summary'){
      if(d.phase==='allowance'){
        const a=d.allowance;
        if(!a.id){
          if(!boundary&&id&&id!==a.after&&context.claim&&(context.attempt||context.client===a.owner))a.id=id;
          else if(!boundary&&id&&id!==a.after)otherVideo=true;
        }
        if(a.id){
          if(mode==='next'&&context.targetId===a.id)otherVideo=false;
          else if(id===a.id&&boundary&&(mode==='ended'||context.targetId!==a.id))offer(d,'extra-episode-finished',context,item,now);
          else if(id!==a.id){
            if(context.attempt)offer(d,'extra-episode-finished',context,item,now);
            else otherVideo=true; // A paused second tab must not consume the active allowance.
          }
        }
      }else if(d.phase==='normal'){
        const timeBlocked=d.ms>=s.minutes*60000;
        const episodeBlocked=boundary?(!context.targetId||!baseAllowed(d,context.targetId,s))&&count(d)>=s.episodes:item.kind!=='movie'&&!baseAllowed(d,id,s);
        if(timeBlocked||episodeBlocked)offer(d,timeBlocked?'minutes':'episodes',context,item,now);
      }
    }
    const blocked=d.stopped||d.phase==='offer'||otherVideo;
    return {blocked,cause:d.stopped?'stopped':d.phase==='offer'?d.offer.cause:otherVideo?'other-video':'',today:d,date:dayKey(now),settings:s,count:count(d),revision:d.revision,item,
      context:{...context,mode,watchId:id},action:d.phase==='offer'&&!d.stopped?'episode':null,
      friction:{used:d.extensionsUsed,max:2,waitMs:Math.max(0,(d.offer?.readyAt||now)-now),reasonRequired:d.extensionsUsed===1,phrase:PHRASE,exhausted:d.stopped&&d.extensionsUsed>=2}};
  }
  function add(state,start,end,item){
    while(start<end){
      const next=new Date(start);next.setHours(24,0,0,0);
      const stop=Math.min(end,next.getTime()),d=day(state,start),ms=stop-start;
      const allowed=item.kind==='episode'&&(baseAllowed(d,item.id,state.settings)||d.allowance?.id===item.id);
      d.ms+=ms;
      if(item.kind==='episode'&&item.id&&item.title){
        const e=d.episodes[item.id] ||= {id:item.id,title:item.title,season:item.season||null,episode:item.episode||null,episodeTitle:item.episodeTitle||'',ms:0};
        const before=e.ms;e.ms+=ms;
        if(before<MEANINGFUL_MS&&e.ms>=MEANINGFUL_MS)e.allowed=allowed;
        if(!e.season&&item.season)e.season=item.season;if(!e.episode&&item.episode)e.episode=item.episode;
        if(!e.episodeTitle&&item.episodeTitle)e.episodeTitle=item.episodeTitle;
      }
      start=stop;
    }
  }
  function tick(state,key,message,now){
    const d=day(state,now),item=resolveItem(state,message.item,message.watchId);
    const previous=state.sessions[key],accepted=!previous||message.seq>previous.seq;
    const context={mode:accepted&&message.ended?'ended':'play',watchId:message.watchId||item.id,client:key,claim:accepted&&!message.ended,attempt:accepted&&!!message.attempt};
    if(accepted){
      // Bind before crediting samples, but account the final sample before ended.
      verdict(state,item,now,{...context,mode:'play'});
      const ms=Math.max(0,Math.min(5000,Number(message.ms)||0));
      if(ms)add(state,now-ms,now,item);
      state.sessions[key]={seq:message.seq,seen:now};
      if(message.ended&&item.kind==='episode'&&d.episodes[item.id])d.episodes[item.id].completed=true;
    }
    for(const [id,s]of Object.entries(state.sessions))if(now-s.seen>86400000)delete state.sessions[id];
    const keys=Object.keys(state.days).sort();while(keys.length>90)delete state.days[keys.shift()];
    return verdict(state,item,now,context);
  }
  function choose(state,message,now){
    const d=day(state,now),context=message.context||{},result=verdict(state,message.item,now,{...context,claim:false,attempt:false});
    const reject=notice=>({...result,notice});
    if(message.date!==dayKey(now))return reject('The day changed. Review today’s limits.');
    if(message.choice==='stop'){lock(d,'chosen');return verdict(state,message.item,now,context);}
    if(message.revision!==d.revision)return reject('This decision changed in another tab. Review the prompt again.');
    if(d.phase!=='offer'||d.stopped||message.choice!=='episode')return reject('No further concession is available.');
    if(result.friction.waitMs)return reject('Finish the break before continuing.');
    if(d.extensionsUsed===1&&String(message.reason||'').trim()!==PHRASE)return reject(`Type exactly: ${PHRASE}`);
    const target=d.offer.scopeId,after=d.offer.after;
    d.extensionsUsed++;d.allowance={id:target,after,owner:context.client||null};
    d.extensionHistory.push({at:now,choice:'episode',watchId:target,confirmation:d.extensionsUsed===2?PHRASE:''});
    d.phase='allowance';d.offer=null;d.revision++;
    return verdict(state,message.item,now,{...context,claim:true,attempt:false});
  }
  function navigationVerdict(state,targetId,now,item,watchId,client){return verdict(state,item,now,{mode:'next',targetId:targetId||null,watchId,client});}
  g.LimitEngine={fresh,day,dayKey,count,resolveItem,verdict,tick,choose,navigationVerdict,MEANINGFUL_MS,PHRASE};
})(globalThis);
