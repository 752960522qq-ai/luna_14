import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as Three from '../app/src/main/assets/three.module.js';
import {bridgeState} from './state-bridge.mjs';


export function loadGame({random=()=>.1,profile,adapters={}}={}){
const html=fs.readFileSync(new URL('../app/src/main/assets/index.html',import.meta.url),'utf8'),source=html.split('<script type="module">')[1].split('</script>')[0];
const nodes=new Map(),events=new Map(),storage=new Map();
if(profile!==undefined)storage.set('sky-duel-profile-v1',JSON.stringify(profile));
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
class Audio{constructor(src){this.src=src;this.paused=true;this.currentTime=0}load(){}pause(){this.paused=true}play(){this.paused=false;return Promise.resolve()}}
const math=Object.create(Math);math.random=random;
const window={addEventListener:(n,f)=>(events.get(n)||events.set(n,[]).get(n)).push(f)};
Object.assign(window,adapters.window||{});
const context=vm.createContext({THREE:{...Three,WebGLRenderer:Renderer,Clock},GLTFLoader:Loader,DRACOLoader:Loader,window,document,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},console,Math:math,Audio,innerWidth:900,innerHeight:500,devicePixelRatio:1,requestAnimationFrame(){},addEventListener:window.addEventListener,setTimeout:()=>1,clearTimeout(){},performance:{now:()=>1000},...Object.fromEntries(Object.entries(adapters).filter(([k])=>k!=='window'))});
const run=s=>vm.runInContext(s,context);run(source.replace(/^import .*?;\s*$/gm,''));
bridgeState(context,run);

return {run,context,find,nodes,groups,window,events,storage,advance:(seconds)=>{elapsed=seconds;run("animate()")},renders:()=>renders};
}
