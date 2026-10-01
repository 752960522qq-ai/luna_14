import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const base=fs.readFileSync(new URL('../baseline/v12-index.html',import.meta.url),'utf8'),current=fs.readFileSync(new URL('../game.mjs',import.meta.url),'utf8');
function declaration(source,name){
 const start=source.indexOf('const '+name+'=');let i=source.indexOf('=',start)+1,depth=0,quote='',escaped=false;
 for(;i<source.length;i++){const ch=source[i];if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote='';continue}if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue}if('([{'.includes(ch))depth++;if(')]}'.includes(ch))depth--;if(ch===';'&&depth===0)return source.slice(start,i+1)}throw Error(name)
}
function func(source,name){const start=source.indexOf('function '+name+'(');let i=source.indexOf('(',start),depth=1;while(depth){i++;if(source[i]==='(')depth++;else if(source[i]===')')depth--}let end=source.indexOf('{',i),braces=1;while(braces){end++;if(source[end]==='{')braces++;else if(source[end]==='}')braces--}return source.slice(start,end+1)}
const configs=['AIRCRAFT_SPECS','PROPELLER_SPECS','AIRCRAFT_TREE','planeInfo','weaponInfo','AI_FIGHTER','AUDIO_FILES'];
for(const name of configs){const old=vm.runInNewContext(declaration(base,name)+'\n'+name),now=vm.runInNewContext(declaration(current,name)+'\n'+name);for(const key of Object.keys(old))assert.equal(JSON.stringify(now[key]),JSON.stringify(old[key]),name+':'+key)}
const unchanged=['moveCursorDirection','steerAircraftToward','advanceAircraft','updatePlayerFlightControls','updateCursorTarget','updateFlightAimingHUD','updateDuelBoundary','enforceDuelAIBoundary','updateFighterAI','solveBulletIntercept','updatePropeller','sweptAircraftHit'];
for(const name of unchanged)assert.equal(func(current,name),func(base,name),name);
const restored=func(current,'integrateAircraftFlight').replace('+(AIRCRAFT_SPECS[data.type].levelDragCompensation||0)*along','').replace('+(AIRCRAFT_SPECS[data.type].highSpeedTurnDrag||0)*turnLoad*turnLoad*THREE.MathUtils.smoothstep(speed,data.maxSpeedMps*.75,data.maxSpeedMps)','');
assert.equal(restored,func(base,'integrateAircraftFlight'));
const report={result:'passed',unchangedExistingConfigs:configs,unchangedCoreFunctions:unchanged,flightModelDifferences:'Only F3F-2-configured level-drag compensation and loaded high-speed turn drag; both default to zero for existing aircraft.'};
fs.writeFileSync(new URL('source-v13.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
