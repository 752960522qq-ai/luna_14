// Test the entire projectile step against the aircraft's moving collision box.
// Translation is relative; rotation uses the final frame's orientation.
function sweptAircraftHit(start,end,aircraftRoot,projectileRadius=0){
 const half=aircraftRoot.userData.collisionHalfExtents;if(!half)return false;
 const previous=aircraftRoot.userData.frameStartPosition||aircraftRoot.position;
 const movedStart=start.clone().add(aircraftRoot.position).sub(previous);
 const a=aircraftRoot.worldToLocal(movedStart),b=aircraftRoot.worldToLocal(end.clone());
 const radius=projectileRadius/Math.max(.00001,Math.min(Math.abs(aircraftRoot.scale.x),Math.abs(aircraftRoot.scale.y),Math.abs(aircraftRoot.scale.z)));
 let enter=0,exit=1;
 for(const axis of ['x','y','z']){
  const extent=half[axis]+radius,delta=b[axis]-a[axis];
  if(Math.abs(delta)<1e-9){if(Math.abs(a[axis])>extent)return false;continue}
  let near=(-extent-a[axis])/delta,far=(extent-a[axis])/delta;
  if(near>far)[near,far]=[far,near];enter=Math.max(enter,near);exit=Math.min(exit,far);
  if(enter>exit)return false
 }
 return true
}
function rememberAircraftFrameStart(){
 const roots=[player,...(gameMode==='campaign'?campaignTargets().map(t=>t.root):[enemy])];
 for(const root of roots){if(!root)continue;(root.userData.frameStartPosition??=new THREE.Vector3()).copy(root.position)}
}
