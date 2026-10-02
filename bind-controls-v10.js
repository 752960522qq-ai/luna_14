function bindFlightControls(){
 const joystick=$('#joystick'),knob=$('#joystickKnob');let joystickPointer=null;
 const moveJoystick=e=>{const r=joystick.getBoundingClientRect(),radius=Math.max(1,r.width*.36),rawX=e.clientX-(r.left+r.width/2),rawY=e.clientY-(r.top+r.height/2),length=Math.hypot(rawX,rawY),scale=length>radius?radius/length:1,x=rawX*scale,y=rawY*scale;joystickInput.x=x/radius;joystickInput.y=y/radius;knob.style.transform=`translate(-50%,-50%) translate(${x}px,${y}px)`};
 const releaseJoystick=(e={})=>{if(joystickPointer!==null&&e.pointerId!==undefined&&e.pointerId!==joystickPointer)return;joystickPointer=null;joystickInput.x=0;joystickInput.y=0;knob.style.transform='translate(-50%,-50%)'};
 joystick.addEventListener('pointerdown',e=>{if(!playing||controlSettings.mode!=='joystick'||(joystickPointer!==null&&joystickPointer!==e.pointerId))return;e.preventDefault();joystickPointer=e.pointerId;try{joystick.setPointerCapture(e.pointerId)}catch{}moveJoystick(e)});
 joystick.addEventListener('pointermove',e=>{if(e.pointerId===joystickPointer)moveJoystick(e)});
 ['pointerup','pointercancel','lostpointercapture'].forEach(type=>joystick.addEventListener(type,releaseJoystick));
 const canvas=renderer.domElement;
 canvas.addEventListener('pointerdown',e=>{
  if(!playing||e.button!==0)return;e.preventDefault();
  if(controlSettings.mode==='cursor'&&!keys.look){
   if(cursorDragPointer)return;
   cursorDragPointer={id:e.pointerId,x:e.clientX,y:e.clientY}
  }else{
   if(cameraDragPointer)return;
   cameraDragPointer={id:e.pointerId,x:e.clientX,y:e.clientY};cameraInputAt=worldTime
  }
  try{canvas.setPointerCapture(e.pointerId)}catch{}
 });
 canvas.addEventListener('pointermove',e=>{
  if(cursorDragPointer&&e.pointerId===cursorDragPointer.id){
   const dx=e.clientX-cursorDragPointer.x,dy=e.clientY-cursorDragPointer.y;
   cursorDragPointer.x=e.clientX;cursorDragPointer.y=e.clientY;moveCursorDirection(dx,dy);return
  }
  if(!cameraDragPointer||e.pointerId!==cameraDragPointer.id)return;
  const dx=e.clientX-cameraDragPointer.x,dy=e.clientY-cameraDragPointer.y;cameraDragPointer.x=e.clientX;cameraDragPointer.y=e.clientY;
  cameraOrbitYaw=THREE.MathUtils.euclideanModulo(cameraOrbitYaw-dx*.008+Math.PI,Math.PI*2)-Math.PI;
  cameraOrbitPitch=THREE.MathUtils.clamp(cameraOrbitPitch+dy*.008,-1.25,1.25);cameraInputAt=worldTime
 });
 const releaseCanvas=(e={})=>{
  if(cursorDragPointer&&(e.pointerId===undefined||e.pointerId===cursorDragPointer.id))cursorDragPointer=null;
  if(cameraDragPointer&&(e.pointerId===undefined||e.pointerId===cameraDragPointer.id)){cameraDragPointer=null;cameraInputAt=worldTime}
 };
 ['pointerup','pointercancel','lostpointercapture'].forEach(type=>canvas.addEventListener(type,releaseCanvas));
 const track=$('#throttleTrack');let throttlePointer=null;
 const setThrottle=e=>{const r=track.getBoundingClientRect();throttleValue=THREE.MathUtils.clamp(1-(e.clientY-r.top)/Math.max(r.height,1),0,1);if(player)player.userData.throttle=throttleValue;updateThrottleUI()};
 track.addEventListener('pointerdown',e=>{if(!playing||(throttlePointer!==null&&throttlePointer!==e.pointerId))return;e.preventDefault();throttlePointer=e.pointerId;try{track.setPointerCapture(e.pointerId)}catch{}setThrottle(e)});
 track.addEventListener('pointermove',e=>{if(e.pointerId===throttlePointer)setThrottle(e)});
 const releaseThrottle=(e={})=>{if(throttlePointer!==null&&e.pointerId!==undefined&&e.pointerId!==throttlePointer)return;throttlePointer=null};
 ['pointerup','pointercancel','lostpointercapture'].forEach(type=>track.addEventListener(type,releaseThrottle));
 flightPointerClearers.push(()=>{
  const pointers=[[joystick,joystickPointer],[canvas,cursorDragPointer?.id],[canvas,cameraDragPointer?.id],[track,throttlePointer]];
  pointers.forEach(([node,id])=>{if(id!==null&&id!==undefined)try{if(node.hasPointerCapture(id))node.releasePointerCapture(id)}catch{}});
  releaseJoystick();releaseCanvas();releaseThrottle()
 })
}
