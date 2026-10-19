const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/dashboard.js', 'utf8');
const channelsFn = source.slice(source.indexOf('function getSessionClipChannels()'), source.indexOf('async function loadClips('));
const eventsFn = source.slice(source.indexOf('function handleClipWsEvent('), source.indexOf('// Creación en vivo de clips', source.indexOf('function handleClipWsEvent(')));
function browser(auth = {}) {
 const ctx = {appConfig: {twitch:{channel:'foreign', connected:true, botUsername:'foreign'}, kick:{channel:'foreignkick'}}, localStorage:{getItem:k=>auth[k] || null}, getUserSession:()=>({id:'user-a'}), getActiveStreamerRoom:()=> 'foreign', allClipsStore:{all:[],chat:[],twitch:[],kick:[]}, applyClipsFilter(){},showToast(){}};
 vm.createContext(ctx);vm.runInContext(channelsFn+eventsFn,ctx);return ctx;
}
(async()=>{
 let ctx=browser();assert.equal(ctx.getSessionClipChannels().isConfigured,false,'Global config must not link a personal account');
 for(const platform of ['twitch','kick']) {
  const key=`orbibot_${platform}_auth`;
  ctx=browser({[key]:JSON.stringify({channel:'mine'})});
  assert.equal(ctx.getSessionClipChannels()[platform],'mine');
  ctx.handleClipWsEvent('clip_added',{id:'other',channel:'other',platform});
  ctx.handleClipWsEvent('clip_added',{id:'unscoped',platform});
  assert.equal(ctx.allClipsStore.all.length,0,'Foreign/unscoped events must be ignored with one linked platform');
  ctx.handleClipWsEvent('clip_added',{id:'mine',channel:'mine',platform});
  assert.equal(ctx.allClipsStore.all.length,1);
 }
 const storage={getConfig:()=>({twitch:{channel:'global',userId:'wrong',oauthToken:'token',clientId:'client'},kick:{channel:'global-kick'}}),getClips:()=>[],saveConfig(){}};
 const serviceContext={module:{exports:{}},require:()=>storage,console,process:{env:{}},fetch:async url=>{
  if(url.includes('/users?')) return {ok:true,json:async()=>({data:[{id:'correct'}]})};
  assert.ok(url.includes('broadcaster_id=correct'),'Clips must use the resolved login ID');
  return {ok:true,json:async()=>({data:[]})};
 }};
 vm.createContext(serviceContext);vm.runInContext(fs.readFileSync('src/services/clipService.js','utf8'),serviceContext);
 const service=serviceContext.module.exports;
 await service.fetchTwitchClips('mine');
 const calls=[];
 service.fetchTwitchClips=async channel=>{calls.push(['twitch',channel]);return []};
 service.fetchKickClips=async channel=>{calls.push(['kick',channel]);return []};
 service.checkTwitchClipsScope=async()=>({hasClipsEdit:false});
 await service.getClipsSummary(true,{});assert.equal(calls.length,0,'Empty sessions must not use global channels');
 await service.getClipsSummary(true,{twitchChannel:'mine'});assert.deepEqual(calls,[['twitch','mine']]);calls.length=0;
 await service.getClipsSummary(true,{kickChannel:'mine'});assert.deepEqual(calls,[['kick','mine']]);
 const html=fs.readFileSync('public/index.html','utf8');
 for(const removed of ['id="sidebarCollapseBtn"','id="topTwitchLoginBtn"','class="topbar-brand"']) assert.ok(!html.includes(removed));
 assert.ok(html.includes('topbar-toggle-btn'));
 console.log('PASS: linked accounts, one-platform isolation, broadcaster resolution, empty sessions and header controls');
})().catch(e=>{console.error(e);process.exitCode=1});
