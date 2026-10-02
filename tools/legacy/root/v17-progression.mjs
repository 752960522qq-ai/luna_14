// One owned aircraft opens the next BR stage, across all national branches.
const RESEARCH_COSTS={
 i15:{rp:0,gp:0},i15bis:{rp:0,gp:0},
 f3f2:{rp:400,gp:1200},bf109b1:{rp:500,gp:1400},i16:{rp:500,gp:1400},p36a:{rp:550,gp:1600},
 mig3:{rp:1600,gp:4500},b29:{rp:4800,gp:14000},
 meteor:{rp:7000,gp:22000},mig15:{rp:7500,gp:24000},f86:{rp:7800,gp:26000}
};
const ECONOMY_RULES={startGP:2000,maxBalance:999999999,killRP:80,killGP:200,winRP:120,winGP:400,lossRP:30,lossGP:100,timeRP:.3,timeGP:.8,maxRewardSeconds:300,minResultSeconds:20};
let economy={rp:0,gp:ECONOMY_RULES.startGP,research:{},completedSorties:0};
let battleRewardSeconds=0,battleRewardSettled=true;
function economyInteger(value,maximum=ECONOMY_RULES.maxBalance){return Number.isFinite(value)?Math.min(maximum,Math.max(0,Math.floor(value))):0}
function loadProgressionProfile(){
 let saved=null;try{saved=JSON.parse(localStorage.getItem(PROFILE_KEY)||'null')}catch{}
 if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};
 const preserved=Array.isArray(saved.unlocked)?saved.unlocked.filter(id=>typeof id==='string'&&AIRCRAFT_SPECS[id]):[];
 unlockedPlanes=[...new Set(['i15','i15bis',...preserved])];
 selectedAircraft=unlockedPlanes.includes(saved.selected)?saved.selected:'i15';
 if(BOMBER_LOADOUTS[saved.bomberLoadout])selectedBombPayload=saved.bomberLoadout;
 const wallet=saved.economy;
 if(wallet&&typeof wallet==='object'&&!Array.isArray(wallet)){
  economy={rp:economyInteger(wallet.rp),gp:economyInteger(wallet.gp),research:{},completedSorties:economyInteger(wallet.completedSorties)};
  if(wallet.research&&typeof wallet.research==='object')for(const[type,value]of Object.entries(wallet.research))if(RESEARCH_COSTS[type])economy.research[type]=economyInteger(value,RESEARCH_COSTS[type].rp)
 }else economy={rp:0,gp:ECONOMY_RULES.startGP,research:{},completedSorties:0};
 playerPlane=selectedAircraft;saveHangar()
}
function researchStages(){return[...new Set(Object.values(AIRCRAFT_TREE).map(info=>info.rating))].sort((a,b)=>a-b)}
function researchPrerequisite(type){
 const rating=AIRCRAFT_TREE[type]?.rating;if(!Number.isFinite(rating))return{allowed:false,rating:null,choices:[]};
 const prior=researchStages().filter(value=>value<rating-1e-9).at(-1);
 if(prior===undefined)return{allowed:true,rating:null,choices:[]};
 const choices=Object.keys(AIRCRAFT_TREE).filter(id=>Math.abs(AIRCRAFT_TREE[id].rating-prior)<1e-9);
 return{allowed:choices.some(id=>unlockedPlanes.includes(id)),rating:prior,choices}
}
function aircraftResearchState(type){
 const cost=RESEARCH_COSTS[type];if(!cost)return{status:'invalid'};
 const owned=unlockedPlanes.includes(type),progress=owned?cost.rp:economyInteger(economy.research[type],cost.rp),prerequisite=researchPrerequisite(type);
 return{status:owned?'owned':!prerequisite.allowed?'blocked':progress>=cost.rp?'ready':'research',owned,progress,cost,prerequisite}
}
function investAircraftResearch(type){
 const state=aircraftResearchState(type);if(state.status!=='research')return{ok:false,reason:state.status};
 const amount=Math.min(economy.rp,state.cost.rp-state.progress);if(amount<=0)return{ok:false,reason:'points'};
 economy.rp-=amount;economy.research[type]=state.progress+amount;saveHangar();return{ok:true,amount,complete:economy.research[type]===state.cost.rp}
}
function purchaseResearchedAircraft(type){
 const state=aircraftResearchState(type);if(state.status!=='ready')return{ok:false,reason:state.status};
 if(economy.gp<state.cost.gp)return{ok:false,reason:'gp'};
 economy.gp-=state.cost.gp;unlockedPlanes.push(type);saveHangar();return{ok:true}
}
function beginSortieEconomy(){battleRewardSeconds=0;battleRewardSettled=false;const reward=$('#sortieRewards');if(reward){reward.textContent='';reward.classList.add('hidden')}}
function settleSortieEconomy(win){
 if(battleRewardSettled)return null;battleRewardSettled=true;
 const seconds=Math.min(ECONOMY_RULES.maxRewardSeconds,Math.max(0,battleRewardSeconds)),confirmedKills=economyInteger(kills,100),eligible=seconds>=ECONOMY_RULES.minResultSeconds||confirmedKills>0;
 const rp=Math.floor(seconds*ECONOMY_RULES.timeRP)+confirmedKills*ECONOMY_RULES.killRP+(eligible?(win===true?ECONOMY_RULES.winRP:ECONOMY_RULES.lossRP):0);
 const gp=Math.floor(seconds*ECONOMY_RULES.timeGP)+confirmedKills*ECONOMY_RULES.killGP+(eligible?(win===true?ECONOMY_RULES.winGP:ECONOMY_RULES.lossGP):0);
 economy.rp=economyInteger(economy.rp+rp);economy.gp=economyInteger(economy.gp+gp);economy.completedSorties=economyInteger(economy.completedSorties+1);saveHangar();updateEconomyDisplay();
 const reward=$('#sortieRewards');if(reward){reward.textContent=`本局获得 ${rp} 研发点 · ${gp} GP`;reward.classList.remove('hidden')}
 return{rp,gp,seconds,kills:confirmedKills}
}
function updateEconomyDisplay(){
 document.querySelectorAll('[data-wallet-rp]').forEach(node=>node.textContent=economy.rp.toLocaleString('zh-CN'));
 document.querySelectorAll('[data-wallet-gp]').forEach(node=>node.textContent=economy.gp.toLocaleString('zh-CN'));
 const campaignOwned=unlockedPlanes.includes('mig15'),choose=$('#chooseCampaign'),begin=$('#beginCampaign'),use=$('#useCatalogPlane');
 if(choose){choose.disabled=!campaignOwned;const label=choose.querySelector('span');if(label)label.textContent=campaignOwned?'米格之舞 · 1951·朝鲜 · 6×6公里':'需先研发并购买 MiG-15'}
 if(begin&&$('#battleLoading')?.classList.contains('hidden'))begin.disabled=!campaignOwned;
 if(use){use.disabled=!unlockedPlanes.includes(previewType);use.textContent=use.disabled?'请先在研发中解锁':'设为出战机'}
}
function handleResearchAircraft(type){
 const state=aircraftResearchState(type);
 if(state.status==='owned'){setSelectedAircraft(type);renderResearch();return}
 if(state.status==='blocked'){toast('先解锁一架 BR '+state.prerequisite.rating.toFixed(1)+' 飞机');return}
 if(state.status==='research'){
  const result=investAircraftResearch(type);toast(result.ok?(result.complete?'研发完成，使用 GP 购买入库':'已投入 '+result.amount+' 研发点'):'研发点不足，请完成对局获得研发点')
 }else if(state.status==='ready'){
  const result=purchaseResearchedAircraft(type);if(result.ok){setSelectedAircraft(type);toast(planeInfo[type].name+' 已入库')}else toast('GP 不足，请完成对局获得 GP')
 }
 updateEconomyDisplay();renderHangar();renderResearch()
}
function treeVehicleCard(type){
 const tree=AIRCRAFT_TREE[type],selected=selectedAircraft===type,state=aircraftResearchState(type),blocked=state.status==='blocked';
 let status,action;
 if(state.owned){status=selected?'当前出战':'已入库';action='选择出战'}
 else if(blocked){status='需先入库任一 BR '+state.prerequisite.rating.toFixed(1)+' 飞机';action='前置未解锁'}
 else if(state.status==='ready'){status='研发完成 · '+state.cost.gp.toLocaleString('zh-CN')+' GP';action=economy.gp>=state.cost.gp?'购买入库':'GP 不足'}
 else{status=state.progress+' / '+state.cost.rp+' 研发点 · '+state.cost.gp.toLocaleString('zh-CN')+' GP';action=economy.rp>0?'投入研发点':'等待研发点'}
 return '<button class="tech-node'+(selected?' selected':'')+(blocked?' research-blocked':'')+'" data-tree-plane="'+type+'" aria-pressed="'+selected+'"'+(blocked?' disabled':'')+'><span class="node-art">'+aircraftGlyph(type)+'</span><span class="node-copy"><small>BR '+tree.rating.toFixed(1)+' · '+AIRCRAFT_SPECS[type].lengthMeters.toFixed(2)+' m</small><strong>'+nationFlag(tree.nation)+planeInfo[type].name+'</strong><em>'+status+'</em><span class="research-progress"><i style="width:'+(state.cost.rp?state.progress/state.cost.rp*100:100)+'%"></i></span><span class="research-action">'+action+'</span></span><span class="node-state">'+tree.rank+' 阶</span></button>'
}
