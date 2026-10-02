import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadGame} from './screen-runtime.mjs';

const checks=[], starter=['bf109b1','f3f2','i15bis','i15'], key='silverwing.profile.1.0';
const all=JSON.parse(fs.readFileSync(new URL('../data/all-aircraft-1.0.json',import.meta.url),'utf8'));
const data=h=>JSON.parse(h.run('JSON.stringify({owned:unlockedPlanes,selected:selectedAircraft,economy,mode:profileState.profileMode})'));
let h=loadGame();
assert.deepEqual(data(h).owned,starter);assert.equal(data(h).selected,'i15');assert.equal(data(h).economy.rp,0);assert.equal(data(h).economy.gp,2000);
assert.deepEqual(JSON.parse(h.run('JSON.stringify(researchStages())')),[1,1.3,2,2.3]);
assert.equal(h.run("aircraftResearchState('i16').status"),'research');assert.equal(h.run("aircraftResearchState('bf109c1').status"),'research');assert.equal(h.run("aircraftResearchState('mig3').status"),'blocked');
for(const type of ['f86','mig15','meteor','b29']){
 h.context.type=type;h.run('economy.rp=999999;economy.gp=999999;economy.research[type]=999999');
 assert.equal(h.run('aircraftResearchState(type).status'),'unavailable');assert.equal(h.run('investAircraftResearch(type).ok'),false);assert.equal(h.run('purchaseResearchedAircraft(type).ok'),false);assert.equal(h.run('setSelectedAircraft(type)'),false);
}
assert(h.find('#chooseCampaign').disabled);checks.push('New standard profile grants exactly Bf-109 B-1, F3F-2, I-15bis and I-15; research is limited to four nations / Rank I-II even with excess money and research');
h=loadGame();h.run("economy.rp=1650;investAircraftResearch('bf109c1')");assert.equal(data(h).economy.rp,50);assert.equal(h.run("aircraftResearchState('bf109c1').status"),'ready');assert.equal(h.run("aircraftResearchState('mig3').status"),'blocked');
h.run('economy.gp=4499');assert.equal(h.run("purchaseResearchedAircraft('bf109c1').ok"),false);assert.equal(data(h).economy.gp,4499);
h.run('economy.gp=4500');assert.equal(h.run("purchaseResearchedAircraft('bf109c1').ok"),true);assert.equal(data(h).economy.gp,0);assert.equal(data(h).owned.length,5);assert.equal(h.run("aircraftResearchState('mig3').status"),'research');assert.equal(h.run("purchaseResearchedAircraft('bf109c1').ok"),false);
const saved=JSON.parse(h.storage.get(key)),reloaded=loadGame({profile:saved});assert.deepEqual(data(reloaded),data(h));checks.push('Bf-109 C-1 needs 1600 RP and 4500 GP; exact capped charges, insufficient funds, one-time purchase and next-stage ownership gate survive reload');
const old={version:2,unlocked:Object.keys(all.economy.research),selected:'f86',economy:{rp:999999,gp:999999,research:{mig15:7800},completedSorties:99}};
const legacy=loadGame({legacyProfile:old});assert.deepEqual(data(legacy).owned,starter);assert.equal(data(legacy).selected,'i15');assert.equal(data(legacy).economy.rp,0);assert.equal(data(legacy).economy.gp,2000);assert.equal(data(legacy).economy.completedSorties,0);assert.deepEqual(JSON.parse(legacy.storage.get('sky-duel-profile-v1')),old);
const oldInNewSlot=loadGame({profile:old});assert.deepEqual(data(oldInNewSlot),data(legacy));checks.push('Old v18 progress is ignored, including old aircraft, selected plane, money and sortie count; placing old-format data in the new slot is also rejected');
const malformed=loadGame({profile:{...saved,unlocked:['invalid','f86'],selected:'f86',economy:{rp:-99,gp:null,research:{i16:999999,f86:999999},completedSorties:-8}}});assert.deepEqual(data(malformed).owned,starter);assert.equal(data(malformed).economy.rp,0);assert.equal(data(malformed).economy.gp,0);assert.equal(data(malformed).economy.research.i16,500);assert(!('f86' in data(malformed).economy.research));assert.equal(data(malformed).selected,'i15');checks.push('Standard profiles filter unavailable ownership, unknown IDs, negative money and oversized research');
h=loadGame();h.context.saveText=JSON.stringify(all);assert.equal(h.run('importProgressionProfile(saveText).ok'),true);assert.equal(data(h).owned.length,12);assert.equal(data(h).selected,'bf109c1');assert.equal(data(h).mode,'all-aircraft');assert(!h.find('#chooseCampaign').disabled);
const fullReload=loadGame({profile:JSON.parse(h.storage.get(key))});assert.deepEqual(data(fullReload),data(h));
for(const type of all.unlocked){h.context.type=type;assert.equal(h.run('setSelectedAircraft(type)'),true)}
checks.push('Delivered all-aircraft JSON imports and persists all twelve selectable aircraft, including the four closed aircraft; ordinary research remains limited');
const before=data(h);h.context.saveText=JSON.stringify(old);assert.equal(h.run('importProgressionProfile(saveText).reason'),'format');assert.deepEqual(data(h),before);
h.run('window.realSave=localStorage.setItem;localStorage.setItem=()=>{throw Error("quota")};saveText=JSON.stringify(freshProgressionProfile())');assert.equal(h.run('importProgressionProfile(saveText).reason'),'storage');assert.deepEqual(data(h),before);h.run('localStorage.setItem=window.realSave');
h.run("gameMode='airspace';reset()");assert.equal(h.run('importProgressionProfile(saveText).reason'),'battle');h.window.showPause();assert.equal(h.run('importProgressionProfile(saveText).reason'),'battle');checks.push('Invalid versions, failed persistence and live/paused battles cannot overwrite the active profile');
h=loadGame();h.run("gameMode='duel';reset();battleRewardSeconds=180;kills=2;finish(true)");assert.equal(data(h).economy.rp,334);assert.equal(data(h).economy.gp,2944);h.run('finish(true)');assert.equal(data(h).economy.rp,334);assert.equal(data(h).economy.gp,2944);
h.run("gameMode='airspace';reset();battleRewardSeconds=60;kills=1;finishAirspaceBattle('red')");assert.equal(data(h).economy.rp,462);assert.equal(data(h).economy.gp,3292);h.run("finishAirspaceBattle('red')");assert.equal(data(h).economy.rp,462);
h.run("gameMode='campaign';reset();battleRewardSeconds=300;kills=3;finish(true)");assert.equal(data(h).economy.rp,912);assert.equal(data(h).economy.gp,4532);checks.push('Original RP/GP reward rules and protection against duplicate results remain intact');
h=loadGame();h.run("gameMode='airspace';reset()");for(let i=0;i<60;i++)h.advance(1/60);const t=h.run('battleRewardSeconds');assert(Math.abs(t-1)<1e-7);h.window.showPause();h.advance(120);assert.equal(h.run('battleRewardSeconds'),t);checks.push('Rewards exclude pause and loading time');
const report={result:'passed',gameVersion:'1.0',checks,starter,allAircraftCount:all.unlocked.length,costs:JSON.parse(h.run('JSON.stringify(RESEARCH_COSTS)'))};
fs.writeFileSync(new URL('progression-v20.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
