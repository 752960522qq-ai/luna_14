import fs from 'node:fs';
const bindings=JSON.parse(fs.readFileSync(new URL('../src/state-bindings.json',import.meta.url),'utf8'));

// Legacy regression probes can address the new explicit state owners.
// This bridge is used only by tests, never by the shipped game.
export function bridgeState(context,run,{seed=false}={}){
 for(const owner of new Set(Object.values(bindings)))if(seed)run('const '+owner+'={};');
 for(const [name,owner] of Object.entries(bindings)){
  const object=run(owner),has=Object.hasOwn(context,name),value=has?context[name]:undefined;
  if(seed&&has)object[name]=value;
  Object.defineProperty(context,name,{configurable:true,enumerable:true,get:()=>object[name],set:v=>{object[name]=v}});
 }
}
export {bindings};
