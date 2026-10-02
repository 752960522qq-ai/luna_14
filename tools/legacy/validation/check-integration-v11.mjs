import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as Three from '../app/src/main/assets/three.module.js';

const html=fs.readFileSync(new URL('../app/src/main/assets/index.html',import.meta.url),'utf8'),source=html.split('<script type="module">')[1].split('</script>')[0];
const nodes=new Map(),events=new Map(),storage=new Map();
class Node {
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.style={setProperty(k,v){this[k]=v}};this.dataset={};this.children=[];this.events={};this.textContent='';this.innerHTML='';this.value='';this.checked=false;this.classes=new Set();this.classList={add:(...s)=>s.forEach(x=>this.classes.add(x)),remove:(...s)=>s.forEach(x=>this.classes.delete(x)),toggle:(s,b)=>{b??=!this.classes.has(s);b?this.classes.add(s):this.classes.delete(s)},contains:s=>this.classes.has(s)};this.captures=new Set()}
 addEventListener(name,fn){(this.events[name]??=[]).push(fn)}
 fire(name,extra={}){for(const f of this.events[name]||[])f({target:this,preventDefault(){},button:0,...extra})}
 setAttribute(k,v){this[k]=v}getAttribute(k){return this[k]}
 appendChild(x){this.children.push(x);return x}append(x){this.children.push(x)}replaceChildren(...x){this.children=x}remove(){}
 querySelectorAll(){return []}querySelector(selector){if(selector.startsWith('.')&&this.innerHTML.includes(selector.slice(1))){this._queried??=new Map();if(!this._queried.has(selector))this._queried.set(selector,new Node());return this._queried.get(selector)}return null}
 setPointerCapture(i){this.captures.add(i)}hasPointerCapture(i){return this.captures.has(i)}releasePointerCapture(i){this.captures.delete(i)}
 getBoundingClientRect(){return{left:0,top:0,width:150,height:150}}
 getContext(){return new Proxy({createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}}),measureText:s=>({width:s.length*8})},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})}
}
const tags=[...html.split('<script type="module">')[0].matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)],groups={radios:[],keys:[],preview:[],filters:[]};
for(const [,tag,attributes] of tags){
 const n=new Node(tag),id=attributes.match(/\bid="([^"]+)"/);for(const c of (attributes.match(/\bclass="([^"]+)"/)?.[1]||'').split(/\s+/))if(c)n.classes.add(c);
 for(const [,key,value] of attributes.matchAll(/data-([\w-]+)="([^"]*)"/g))n.dataset[key.replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=value;
 n.value=attributes.match(/\bvalue="([^"]+)"/)?.[1]||'';if(id)nodes.set('#'+id[1],n);
 if(attributes.includes('name="flightControlMode"'))groups.radios.push(n);if(n.dataset.key)groups.keys.push(n);if(n.dataset.previewPlane)groups.preview.push(n);if(n.dataset.nationFilter)groups.filters.push(n);
}
const all=s=>s==='[name="flightControlMode"]'?groups.radios:s==='[data-key]'?groups.keys:s==='[data-preview-plane]'?groups.preview:s==='[data-nation-filter]'?groups.filters:[];
const find=s=>nodes.get(s)||groups.keys.find(n=>s===`[data-key="${n.dataset.key}"]`)||(s==='#enemyMarker .marker-label'?(nodes.get(s)||nodes.set(s,new Node()).get(s)):null);
const document={querySelector:find,querySelectorAll:all,createElement:t=>new Node(t),addEventListener:(n,f)=>(events.get(n)||events.set(n,[]).get(n)).push(f),hidden:false};
let elapsed=0,renders=0;class Clock{getDelta(){const value=elapsed;elapsed=0;return value}}
class Renderer{constructor(options={}){this.domElement=options.canvas||new Node('canvas')}setPixelRatio(){}setSize(){}render(){renders++}}
class Loader{setDecoderPath(){return this}setDRACOLoader(){return this}loadAsync(){return new Promise(()=>{})}}
class Audio{constructor(){this.paused=true;this.currentTime=0}load(){}pause(){this.paused=true}play(){this.paused=false;return Promise.resolve()}}
const math=Object.create(Math);math.random=()=>.1;
const window={addEventListener:(n,f)=>(events.get(n)||events.set(n,[]).get(n)).push(f)};
const context=vm.createContext({THREE:{...Three,WebGLRenderer:Renderer,Clock},GLTFLoader:Loader,DRACOLoader:Loader,window,document,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},console,Math:math,Audio,innerWidth:900,innerHeight:500,devicePixelRatio:1,requestAnimationFrame(){},addEventListener:window.addEventListener,setTimeout:()=>1,clearTimeout(){},performance:{now:()=>1000}});
const run=s=>vm.runInContext(s,context);run(source.replace(/^import .*?;\s*$/gm,''));
const check=[];assert(!find('#menu').classList.contains('hidden'),'Home did not initialize');check.push('Full embedded module initializes and renders with graphics/media adapters');
find('#openSettings').fire('click');assert(!find('#settings').classList.contains('hidden'));const joystick=groups.radios.find(n=>n.value==='joystick');joystick.checked=true;joystick.fire('change');assert.equal(run('controlSettings.mode'),'joystick');assert.equal(find('#homeControlMode').textContent,'摇杆操作');assert.equal(find('#cursorSensitivity').disabled,true);find('#settingsHome').fire('click');assert(!find('#menu').classList.contains('hidden'));check.push('Home settings switch and persist joystick mode');
run("setSelectedAircraft('bf109b1');throttleValue=.4");find('#start').fire('click');assert(!find('#modeSelect').classList.contains('hidden'));find('#chooseAIBattle').fire('click');assert.equal(run('throttleValue'),1);assert.equal(find('#throttlePercent').textContent,'100%');assert.equal(run('playing'),true);assert(!find('#joystick').classList.contains('hidden'));check.push('AI sortie starts with 100% throttle and requested controls');
for(let i=0;i<60;i++){elapsed=1/60;run('animate()')}assert(Number.isFinite(run('player.userData.airspeed')));check.push('Full animation connects shared physics and HUD');
run("enemy.position.copy(player.position).add(new THREE.Vector3(0,0,-50));enemy.userData.velocity.set(4,0,0);cursorTarget=null;cursorCandidate=null;cursorCandidateSeconds=0;for(let i=0;i<30;i++)updateCursorTarget(1/60);updateChaseCamera(1/60)");assert.equal(find('#leadIndicator').style.display,'block');assert.equal(find('#aimCursor').style.display,'none');check.push('Joystick lead appears through actual animation HUD/camera functions');
run('player.position.set(1131,200,0);player.userData.velocity.set(0,0,0)');elapsed=1;run('animate()');assert(find('#boundaryWarning').textContent.includes('临阵脱逃，自毁倒计时：14秒'));assert(!find('#boundaryWarning').classList.contains('hidden'));
window.showPause();const remaining=run('duelDesertionRemaining');elapsed=200;run('animate()');assert.equal(run('duelDesertionRemaining'),remaining);find('#again').fire('click');assert.equal(run('playing'),true);assert.equal(run('duelDesertionRemaining'),remaining);check.push('Actual pause/resume flow freezes warning countdown');
run('player.position.x=1130');elapsed=.2;run('animate()');assert(find('#boundaryWarning').classList.contains('hidden'));assert.equal(run('duelDesertionRemaining'),null);run('player.position.x=1131');for(let i=0;i<15;i++){elapsed=1;run('animate()')}
assert.equal(run('playing'),false);assert.equal(run('hp'),0);assert.equal(run('player.userData.destroyed'),true);assert.equal(find('#resultTitle').textContent,'临阵脱逃');assert(!find('#end').classList.contains('hidden'));check.push('Full animation executes self destruction and result screen after 15 active seconds');
find('#again').fire('click');assert.equal(run('playing'),true);assert.equal(run('duelDesertionRemaining'),null);assert(find('#boundaryWarning').classList.contains('hidden'));check.push('Restart clears previous boundary state');
find('#returnHome').fire('click');find('#chooseCampaign').fire('click');find('#beginCampaign').fire('click');assert.equal(run('gameMode'),'campaign');assert.equal(run('campaignBombers.length'),3);assert.equal(run('campaignEscorts.length'),5);run('player.position.set(400,200,400)');elapsed=16;run('animate()');assert.equal(run('duelDesertionRemaining'),null);assert.equal(run('playing'),true);check.push('Campaign setup and full animation remain exempt from duel desertion rules');
fs.writeFileSync(new URL('integration-v11.json',import.meta.url),JSON.stringify({method:'Entire embedded module executed in Node VM with DOM/WebGL/media adapters. No rendered WebGL or Android device test.',result:'passed',renders,checks:check},null,2));console.log(JSON.stringify({result:'passed',renders,checks:check},null,2));
