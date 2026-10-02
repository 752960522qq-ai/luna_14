import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../app/src/main/assets/three.module.js';
import {loadGame} from './screen-runtime.mjs';

const quiet={log(){},warn(){},error(){}};
const load=options=>loadGame({...options,adapters:{console:quiet}});
const plain=v=>JSON.parse(JSON.stringify(v));
const report={result:'passed',checks:[]};
{
 const h=load();h.run("delete planeModelPromises.f86;window.attempts=0;planeModelLoader.loadAsync=()=>{window.attempts++;return Promise.reject(Error('temporary'))}");
 await assert.rejects(h.run("loadPlaneModel('f86')"));
 h.run("planeModelLoader.loadAsync=()=>{window.attempts++;return Promise.resolve({scene:new THREE.Group()})}");
 await h.run("loadPlaneModel('f86')");assert.equal(h.window.attempts,2);
 // A failed, unrelated hangar preview must not block a valid battle roster.
 h.run("planeModelPromises.b29=Promise.reject(Error('unrelated'));planeModelPromises.b29.catch(()=>{});gameMode='duel';player=new THREE.Group();player.userData={type:'f86',modelReady:Promise.resolve(true),modelAttached:true};enemy=null;updateChaseCamera=()=>{}");
 await h.run('warmBattleRenderer()');report.checks.push('Failed aircraft loads are evicted and retry; renderer warms only the active roster.');
}
{
 const h=load();h.run("economy.rp=550;window.save=localStorage.setItem;localStorage.setItem=()=>{throw Error('quota')}");
 const before=plain(h.run('({economy,unlockedPlanes})'));
 assert.equal(h.run("investAircraftResearch('i16').reason"),'storage');assert.deepEqual(plain(h.run('({economy,unlockedPlanes})')),before);
 h.run('economy.research.i16=500');const gp=h.run('economy.gp');assert.equal(h.run("purchaseResearchedAircraft('i16').reason"),'storage');assert.equal(h.run('economy.gp'),gp);assert(!h.run("unlockedPlanes.includes('i16')"));
 assert(!h.run("setSelectedAircraft('i15bis')"));assert.equal(h.run('selectedAircraft'),'i15');
 h.run("gameMode='airspace';reset();battleRewardSeconds=180;kills=2;finishAirspaceBattle('blue')");
 assert.equal(h.run('pendingRewards.length'),1);assert.equal(h.run('economy.gp'),gp);
 h.run("localStorage.setItem=window.save;showMenuScreen('menu')");assert.equal(h.run('pendingRewards.length'),0);assert.equal(h.run('economy.gp'),gp+944);
 h.run("showMenuScreen('menu')");assert.equal(h.run('economy.gp'),gp+944);report.checks.push('Research, purchase and selection roll back on storage errors; results retry once without duplicate rewards.');
}
{
 const h=load({profile:{format:'silverwing-profile',version:1,gameVersion:'1.0',mode:'all-aircraft',unlocked:['b29'],selected:'b29'}});
 h.run("gameMode='airspace';reset();dropBomb();window.disposes=0;bombsInFlight[0].mesh.geometry.addEventListener('dispose',()=>window.disposes++);bombsInFlight[0].mesh.material.addEventListener('dispose',()=>window.disposes++);reset()");
 assert.equal(h.window.disposes,2);
 h.run("window.owned=new THREE.PlaneGeometry();window.released=0;window.owned.addEventListener('dispose',()=>window.released++);ownAircraftResource(player,window.owned);disposeAircraft(player);disposeAircraft(player)");
 assert.equal(h.window.released,1);
 // Removing a root before its asynchronous clone is ready must never attach it later.
 h.run("planeModelPromises.b29=Promise.resolve(new THREE.Group());window.root=aircraft(false,'b29');disposeAircraft(window.root)");await h.run('window.root.userData.modelReady');assert.equal(h.window.root.children.length,0);
 report.checks.push('Bomb reset disposes geometry/material; owned resources dispose once; disposed roots reject late attachment.');
}
{
 const h=load();const music=h.run('menuMusic');assert(music.loop&&!music.paused);assert.equal(music.src,'./audio/menu-bgm-1.mp3');
 for(const screen of ['settings','hangar','research','modeSelect','campaignBriefing','encyclopedia','menu']){h.run(`showMenuScreen('${screen}')`);assert.equal(h.run('menuMusic'),music);assert(!music.paused)}
 h.run("gameMode='airspace';reset()");assert(music.paused);h.window.showPause();h.run('syncMenuMusic()');assert(music.paused);h.run('resumeBattle();syncMenuMusic()');assert(music.paused);
 h.run("finishAirspaceBattle('blue')");assert(!music.paused);
 h.window.onNativePause();assert(music.paused);h.window.onNativeResume();assert(!music.paused);
 h.context.document.hidden=true;for(const f of h.events.get('visibilitychange'))f();assert(music.paused);
 h.context.document.hidden=false;for(const f of h.events.get('visibilitychange'))f();assert(!music.paused);
 report.checks.push('One looping BGM persists across all menus and results; battle, pause, spectating and background stop it.');
}
{
 const h=load();h.run("gameMode='duel';reset();player.userData.propRpm=1800;finish(false)");h.advance(4);assert.equal(h.run('player.userData.propRpm'),0);report.checks.push('Finished non-airspace propellers spool down instead of freezing.');
}
{
 const h=load();h.run("gameMode='airspace';reset()");
 const original=THREE.Vector3,clone=original.prototype.clone;let allocations=0;
 class Counted extends original{constructor(...a){super(...a);allocations++}}
 h.context.THREE.Vector3=Counted;original.prototype.clone=function(){allocations++;return new original(this.x,this.y,this.z)};
 try{for(let i=0;i<60;i++)h.run('updateAirspaceStep(1/60)')}finally{original.prototype.clone=clone;h.context.THREE.Vector3=original}
 assert(allocations<46685*.4,'Vector allocation regression');
 report.vectorAllocations={before:46685,after:allocations,simulationSeconds:1,units:10,modelsLoaded:false,webglMeasured:false};
}
fs.writeFileSync(new URL('repairs-v19.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
