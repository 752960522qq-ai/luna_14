const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const http=require('node:http');
const {chromium}=require((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()+'/node_modules')+'/playwright');
const root=path.resolve(__dirname,'..');
const bridge=`
window.__audioQA={
 ready:()=>Promise.all([...audioLoads.values()]),
 state:()=>({playing,context:audioContext?.state,buffers:[...audioBuffers].map(([name,b])=>({name,duration:b.duration,sampleRate:b.sampleRate,channels:b.numberOfChannels})),engine:engineAudio?{type:engineAudioType,loop:engineAudio.source?.loop,duration:engineAudio.source?.buffer.duration}:null,voices:gunVoices.size}),
 fire:dt=>fireWeapons(player,false,dt,keys.fire),
 throttle:value=>{player.userData.throttle=value;updateEngineAudio()},
 startAgain:()=>startEngineSound(playerPlane),
 home:()=>showMenuScreen('menu'),
 render:()=>{updateChaseCamera(0);renderer.render(scene,camera)},
 offline:async()=>{
  const out=[];
  for(const[name,buffer]of audioBuffers){
   const loop=name.endsWith('Engine'),rate=24000,seconds=loop?buffer.duration*3:1;
   const context=new OfflineAudioContext(1,Math.ceil(seconds*rate),rate),node=context.createBufferSource();
   node.buffer=buffer;node.loop=loop;node.loopStart=0;node.loopEnd=buffer.duration;node.connect(context.destination);node.start(0);
   const samples=(await context.startRendering()).getChannelData(0);
   let peak=0,after=0,minRms=Infinity,maxRms=0;
   for(let i=0;i<samples.length;i++){peak=Math.max(peak,Math.abs(samples[i]));if(!loop&&i>(buffer.duration+.015)*rate)after=Math.max(after,Math.abs(samples[i]))}
   if(loop)for(let i=0;i+rate/2<=samples.length;i+=rate/2){let energy=0;for(let j=i;j<i+rate/2;j++)energy+=samples[j]*samples[j];const rms=Math.sqrt(energy/(rate/2));minRms=Math.min(minRms,rms);maxRms=Math.max(maxRms,rms)}
   out.push({name,loop,duration:buffer.duration,peak,afterShotPeak:after,minRms:loop?minRms:null,rmsRatio:loop?maxRms/minRms:null});
  }
  return out;
 }
};`;
async function main(){
 const assets=path.join(root,'app/src/main/assets');
 const server=http.createServer((request,response)=>{
  const file=path.resolve(assets,'.'+new URL(request.url,'http://localhost').pathname);
  if(!file.startsWith(assets+'/')||!fs.existsSync(file)){response.writeHead(404);return response.end()}
  const type={'.js':'text/javascript','.html':'text/html','.wav':'audio/wav','.mp3':'audio/mpeg','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream';
  response.writeHead(200,{'Content-Type':type});fs.createReadStream(file).pipe(response);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.SKY_DUEL_CHROME||path.resolve(root,'../tools-audio-build/chrome-headless-shell-linux64/chrome-headless-shell'),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:620}}),errors=[],failed=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR:',e.message)});
  page.on('console',message=>{if(message.type()==='error')console.error('BROWSER ERROR:',message.text())});
  page.on('response',r=>{if(r.status()>=400)failed.push({url:r.url(),status:r.status()})});
  await page.addInitScript(()=>{
   // Control frames only; use native WebGL, AudioContext and decoder.
   window.requestAnimationFrame=callback=>{window.__nextFrame=callback;return 1};
   window.__audioNodes=[];
   const original=AudioContext.prototype.createBufferSource;
   AudioContext.prototype.createBufferSource=function(){
    const source=original.call(this),record={};window.__audioNodes.push(record);
    const start=source.start.bind(source),stop=source.stop.bind(source);
    source.start=(...args)=>{Object.assign(record,{started:true,loop:source.loop,duration:source.buffer?.duration,startAt:args[0]||0});return start(...args)};
    source.stop=(...args)=>{record.stopped=true;record.stopAt=args[0]||0;return stop(...args)};
    return source;
   };
  });
  await page.route('**/index.html',route=>route.fulfill({status:200,contentType:'text/html',body:fs.readFileSync(path.join(root,'app/src/main/assets/index.html'),'utf8').replace('</script>',bridge+'\n</script>')}));
  await page.goto(process.env.SKY_DUEL_TEST_URL||'http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'load'});
  await page.waitForFunction(()=>!!window.__audioQA,null,{polling:100,timeout:10000});
  await page.evaluate(()=>window.__audioQA.ready());
  await page.locator('#start').click({force:true});await page.locator('#chooseAIBattle').click({force:true});
  await page.waitForFunction(()=>window.__audioQA.state().context==='running',null,{polling:100});
  const initial=await page.evaluate(()=>window.__audioQA.state());
  assert.equal(initial.buffers.length,9);assert.equal(initial.engine.type,'jet');assert(initial.engine.loop);
  for(const t of [.2,.5,1])await page.evaluate(t=>window.__audioQA.throttle(t),t);
  await page.evaluate(()=>window.__audioQA.startAgain());
  assert.equal(await page.evaluate(()=>window.__audioNodes.filter(n=>n.started&&n.loop).length),1);
  const fire=page.locator('[data-key="fire"]');const box=await fire.boundingBox();assert(box);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.evaluate(()=>window.__audioQA.fire(1/60));await page.mouse.up();
  let shots=await page.evaluate(()=>window.__audioNodes.filter(n=>n.started&&!n.loop));
  assert.equal(shots.length,1);assert(shots[0].duration<=.0751);
  await page.evaluate(()=>window.__audioQA.fire(.2));
  assert.equal(await page.evaluate(()=>window.__audioNodes.filter(n=>n.started&&!n.loop).length),1);
  const offline=await page.evaluate(()=>window.__audioQA.offline());
  for(const sound of offline){assert(sound.peak<.99,JSON.stringify(sound));if(sound.loop){assert(sound.minRms>.05);assert(sound.rmsRatio<1.22,JSON.stringify(sound))}else assert.equal(sound.afterShotPeak,0,JSON.stringify(sound))}
  await page.evaluate(()=>{window.__audioQA.render();window.showPause()});
  assert.equal((await page.evaluate(()=>window.__audioQA.state())).engine,null);
  assert(await page.evaluate(()=>window.__audioNodes.filter(n=>n.started&&n.loop).every(n=>n.stopped)));
  await page.locator('#again').click({force:true});await page.waitForFunction(()=>!!window.__audioQA.state().engine,null,{polling:100});
  await page.evaluate(()=>window.__audioQA.home());assert.equal((await page.evaluate(()=>window.__audioQA.state())).engine,null);
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  const report={result:'passed',method:'Local v12 page in Chromium with native Web Audio/PCM decoder, OfflineAudioContext and SwiftShader WebGL; animation frames controlled by harness. No Android device or subjective listening.',browser:browser.version(),checks:['Nine slices decoded using native browser decoder','Pointer tap makes one short F-86 sample; release does not add sounds','Throttle changes preserve one stationary looping engine node','Offline gun outputs have silence after the one-shot tail','Three engine loops render three continuous periods without quiet startup/shutdown sections','Pause, resume and menu stop/restart the engine at the correct lifecycle'],initial,offline,pageErrors:errors,httpErrors:failed};
  fs.writeFileSync(path.join(__dirname,'browser-audio-v12.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
