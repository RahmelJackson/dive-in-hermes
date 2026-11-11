// Camera coordinates use Y for height. Tilt orbits the active depth.
function mountGlassScene(canvas) {
 const ctx=canvas.getContext('2d',{alpha:true});
 if(!ctx)return null;
 const main=document.querySelector('main'), root=document.documentElement;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const pause=document.querySelector('.motion-toggle');
 const drawOptics=typeof mountGlassOptics==='function'?mountGlassOptics():null;
 // Seed the field so the same scene remains recognizable between visits.
 let seed=82;
 function random(){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return seed/4294967296;
 }
 function field(count,spread,make){
  return Array.from({length:count},(_,index)=>{
   const angle=random()*Math.PI*2, radius=Math.sqrt(random())*spread;
   return {angle,radius,y:17-random()*91,phase:random()*Math.PI*2,...make(index)};
  });
 }
 const bubbles=field(88,16,index=>({
  size:.07+random()**2.7*.73, speed:(index%2?-1:1)*(.035+random()*.065),
  accent:index%6===0, alpha:.25+random()*.52,
 }));
 const motes=field(450,23,()=>({size:.012+random()**2*.036,alpha:.12+random()*.49}));
 let height=23, yaw=0, targetYaw=0, pitch=.13, targetPitch=.13;
 let depth=0, visualDepth=0, elapsed=0, frame, last=0, paused=false;
 let cameraX=0, cameraZ=0, zoom=1, shiftX=0, shiftY=0;
 let verticalSpace=1, frameCenter, readerFade=1, arrival=0, dockBlend=0, dockPosition;
 const sprites=new Map();
 const figureMasks=new Map();
 let story=null;
 function request(){if(frame===undefined)frame=requestAnimationFrame(draw);}
 function shadeSphere(brush,size,theme,accent){
  const image=brush.createImageData(size,size), pixels=image.data;
  const tint=accent?[84,204,181]:theme==='light'?[56,136,209]:[92,166,249];
  const radius=size/2-1, rim=[32,3,25];
  for(let y=0;y<size;y++){
   for(let x=0;x<size;x++){
    const nx=(x+.5-size/2)/radius, ny=(y+.5-size/2)/radius;
    const radial=Math.hypot(nx,ny);
    if(radial>1+1/radius)continue;
    const nz=Math.sqrt(Math.max(0,1-radial*radial));
    const fresnel=(1-nz)**2.7;
    // The reflected view ray places two softboxes on the curved glass surface.
    const rx=2*nx*nz, ry=2*ny*nz, rz=2*nz*nz-1;
    const key=Math.exp(-((rx+.58)**2*7+(ry+.57)**2*25+(rz-.57)**2*5));
    const fill=Math.exp(-((rx-.58)**2*5+(ry-.68)**2*14+(rz-.44)**2*5));
    const edge=Math.exp(-((nz-.22)**2*59))*(.42+.3*nx-.12*ny);
    const band=Math.exp(-((ry-.15*Math.sin(rx*5)+.16)**2*150))*
     Math.exp(-((rx-.39)**2*4+(rz-.38)**2*5));
    const white=key*.92+fill*.38+edge*.53+band*.25;
    const body=.39+.49*fresnel+.20*Math.max(0,ny);
    const opacity=Math.min(1,.43+fresnel*.48+key*.54+fill*.27+edge*.2);
    const offset=(y*size+x)*4;
    for(let channel=0;channel<3;channel++){
     const color=tint[channel]*body+fresnel*rim[channel]*(.5+.5*nx);
     pixels[offset+channel]=color+(255-color)*Math.min(1,white);
    }
    pixels[offset+3]=255*opacity*Math.min(1,Math.max(0,(1-radial)*radius+.5));
   }
  }
  brush.putImageData(image,0,0);
 }
 function sprite(theme,accent,soft,large=false){
  const key=[theme,accent,soft,large].join('/');
  if(sprites.has(key))return sprites.get(key);
  const image=document.createElement('canvas');
  image.width=image.height=large?384:192;
  const brush=image.getContext('2d'), r=image.width/2;
  if(soft){
   const glass=brush.createRadialGradient(r,r,0,r,r,r);
   const tint=accent?'97,232,208':theme==='light'?'83,149,205':'119,185,255';
   glass.addColorStop(0,'rgba('+tint+',.25)');
   glass.addColorStop(.45,'rgba('+tint+',.10)');
   glass.addColorStop(.68,'rgba('+tint+',.39)');
   glass.addColorStop(1,'rgba('+tint+',0)');
   brush.fillStyle=glass;
   brush.beginPath();brush.arc(r,r,r,0,Math.PI*2);brush.fill();
  }else{
   shadeSphere(brush,image.width,theme,accent);
  }
  sprites.set(key,image);
  return image;
 }
 function worldNode(layerIndex,index,count,time,verticalSpace,orbit,lane){
  const drift=time*(.72+index%3*.11)+index*1.43+layerIndex*.92;
  if(lane)return {x:lane.side*2.8+Math.sin(drift)*.16,y:-layerIndex*11+Math.cos(drift)*.24,
   z:(lane.index-(lane.count-1)/2)*1.6*verticalSpace};
  const angle=index/count*Math.PI*2-.5*Math.PI+layerIndex*.41+Math.sin(drift*1.13)*.18;
  const spread=count===1&&!orbit?0:Math.max(orbit,2.18+count*.13)+Math.sin(drift*.83)*.32;
  return {x:Math.cos(angle)*spread+Math.cos(drift*.7)*.14,
   y:-layerIndex*11+Math.cos(drift)*.88,
   z:(Math.sin(angle)*spread+Math.sin(drift*.94)*.23)*verticalSpace};
 }
 function measurementLayout(layer,width,viewportHeight,storyFrame){
  const values=layer.nodes.filter(node=>node.kind==='measurement').map(node=>node.amount);
  if(!values.length)return null;
  const reference=layer.nodes.find(node=>node.kind==='reference')?.amount;
  const min=Math.min(0,reference??0,...values), max=Math.max(0,reference??0,...values);
  const top=Math.max(30,storyFrame?.clipTop??storyFrame?.top??viewportHeight*.2)+38;
  const bottom=Math.min(viewportHeight-36,storyFrame?.clipBottom??storyFrame?.bottom??viewportHeight*.82)-37;
  if(bottom-top<55)return null;
  const span=storyFrame?.span??{left:0,width};
  const left=span.left+Math.max(44,span.width*.13);
  const right=span.left+span.width-Math.max(42,span.width*.10);
  const pad=(max-min)*.07;
  const high=max>0?max+pad:0, low=min<0?min-pad:0;
  const y=value=>bottom-(value-low)/(high-low||1)*(bottom-top);
  return {left,right,top,bottom,y,min,max,zero:y(0),step:(right-left)/values.length,
   reference,unit:layer.visual.unit||''};
 }
 function smooth(start,end,value){
  const t=Math.max(0,Math.min(1,(value-start)/(end-start)));
  return t*t*(3-2*t);
 }
 function figureMask(text){
  if(figureMasks.has(text))return figureMasks.get(text);
  const image=document.createElement('canvas');
  image.width=144;image.height=42;
  const brush=image.getContext('2d');
  if(!brush?.getImageData)return [];
  brush.font='700 33px "Geist Mono", monospace';
  brush.textBaseline='middle';brush.textAlign='center';
  brush.fillText(text,72,22,140);
  const data=brush.getImageData(0,0,144,42).data, dots=[];
  for(let y=2;y<41;y+=3){
   for(let x=2;x<144;x+=3){
    if(data[(y*144+x)*4+3]>150)dots.push([x-72,y-21]);
   }
  }
  if(figureMasks.size>=8)figureMasks.clear();
  figureMasks.set(text,dots);
  return dots;
 }
 function draw(now){
  frame=undefined;
  if(document.hidden||!canvas.clientWidth||!canvas.clientHeight)return;
  const width=canvas.clientWidth, viewportHeight=canvas.clientHeight;
  const scale=Math.min(window.devicePixelRatio||1,2,2400/width,2000/viewportHeight);
  const pixelWidth=Math.round(width*scale), pixelHeight=Math.round(viewportHeight*scale);
  if(canvas.width!==pixelWidth||canvas.height!==pixelHeight){canvas.width=pixelWidth;canvas.height=pixelHeight;}
  const view=main.dataset.view;
  const inStory=story&&view==='story';
  const animate=!paused&&!reduced.matches;
  const dt=Math.min(.05,Math.max(.001,(now-last)/1000));
  last=now;
  const ease=animate?1-Math.exp(-dt*4.3):1;
  const hoverEase=animate?1-Math.exp(-dt*15):1;
  if(animate)elapsed+=dt*(story?.reading ? .28 : 1);
  visualDepth+=(depth-visualDepth)*ease;
  const travel=animate?Math.max(-1,Math.min(1,depth-visualDepth)):0;
  if(inStory&&story.arrived!==story.active&&Math.abs(depth-story.active)<.075&&Math.abs(visualDepth-story.active)<.10){
   story.arrived=story.active;
   arrival=animate?1:0;
  }
  arrival=animate?Math.max(0,arrival-dt*1.45):0;
  readerFade+=((story?.reading ? .72 : 1)-readerFade)*hoverEase;
  let target;
  const storyFrame=inStory&&story.frame;
  if(storyFrame?.dock)dockPosition=storyFrame.dock;
  dockBlend+=((storyFrame?.dock?1:0)-dockBlend)*hoverEase;
  const desiredSpace=storyFrame
   ?Math.max(.30,Math.min(1,(storyFrame.bottom-storyFrame.top-92)/(Math.min(width,viewportHeight)*.61)))
   :1;
  verticalSpace+=(desiredSpace-verticalSpace)*ease;
  const desiredCenter=storyFrame?(storyFrame.top+storyFrame.bottom)/2:viewportHeight*(inStory?.56:.51);
  frameCenter??=desiredCenter;
  frameCenter+=(desiredCenter-frameCenter)*ease;
  if(inStory){
   for(const [layerIndex,layer] of story.layers.entries()){
    const lensDistance=9+Math.max(0,Math.min(1.25,layerIndex-visualDepth))*11;
    const orbit=storyFrame?.hubRadius
     ?(storyFrame.hubRadius+Math.min(76,width*.14))*lensDistance/(Math.min(width,viewportHeight)*.88)
     :0;
    for(const [index,state] of story.motion[layerIndex].entries()){
     const active=layerIndex===story.active;
     const selected=active&&index===story.selected;
     const hovered=active&&index===story.hovered;
     if(animate&&!hovered)state.time+=dt*(story.reading ? (selected ? .18 : .30) : 1);
     state.highlight+=(Number(hovered||selected)-state.highlight)*hoverEase;
     state.pose=worldNode(layerIndex,index,layer.nodes.length,state.time,verticalSpace,orbit,layer.nodes[index].lane);
     if(selected)target=state.pose;
    }
   }
  }
  const wide=width>700;
  const desiredHeight=target?target.y+7.7:inStory?9-visualDepth*11:view==='diving'?14:23;
  height+=(desiredHeight-height)*ease;
  yaw+=(targetYaw+(animate?Math.sin(elapsed*.29)*.18:0)+travel*.32-yaw)*ease;
  pitch+=(targetPitch+(animate?Math.sin(elapsed*.44)*.12:0)-travel*.24-pitch)*ease;
  cameraX+=((target?.x||0)-cameraX)*ease;
  cameraZ+=((target?.z||0)-cameraZ)*ease;
  zoom+=((target?(wide?1.63:1.46):1)-zoom)*ease;
  const subject=target&&storyFrame?.dock?.subject;
  shiftX+=((subject?subject.x/width-.5:target&&wide&&!storyFrame?-.23:0)-shiftX)*ease;
  const focusY=target&&(subject?.y||storyFrame?.focusY);
  const verticalShift=focusY?(focusY-frameCenter)/viewportHeight:target&&!wide?-.16:0;
  shiftY+=(verticalShift-shiftY)*ease;
  ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,width,viewportHeight);
  const theme=root.dataset.theme;
  const light=theme==='light';
  const blue=theme!=='dark'&&!light;
  const palette=light?'light':blue?'blue':'dark';
  const focal=Math.min(width,viewportHeight)*.88*zoom;
  const focusBlend=Math.min(1,(zoom-1)/(wide?.63:.46));
  const centerX=width*(.5+shiftX);
  const centerY=frameCenter+viewportHeight*shiftY;
  const cos=Math.cos(yaw),sin=Math.sin(yaw);
  const pitchCos=Math.cos(pitch),pitchSin=Math.sin(pitch);
  const focusDistance=target?Math.max(3,height-target.y):inStory?Math.max(3,height+visualDepth*11):24;
  function project(x,y,z){
   x-=cameraX;z-=cameraZ;
   const forward=x*sin+z*cos, lift=height-y-focusDistance;
   const distance=focusDistance+lift*pitchCos+forward*pitchSin;
   if(distance<.65)return null;
   return {x:centerX+(x*cos-z*sin)*focal/distance,
    y:centerY+(forward*pitchCos-lift*pitchSin)*focal/distance,scale:focal/distance,distance};
  }
  function defocus(point){
   // Near bubbles bloom quickly, while distant objects soften into smaller bokeh.
   const difference=Math.abs(point.distance-focusDistance);
   const aperture=1.8+focusBlend*.85;
   return Math.min(24,Math.max(0,difference-1.35)*aperture*Math.min(2.6,focusDistance/point.distance));
  }
  function orb(point,r,accent=false,blur=0,spin=0,large=false){
   if(r<1||point.x<-r||point.x>width+r||point.y<-r||point.y>viewportHeight+r)return;
   const alpha=ctx.globalAlpha;
   const softness=Math.min(1,blur/9);
   if(softness>0){
    const spread=r+blur;
    ctx.globalAlpha=alpha*softness;
    ctx.drawImage(sprite(palette,accent,true),point.x-spread,point.y-spread,spread*2,spread*2);
   }
   if(softness<1){
    ctx.globalAlpha=alpha*(1-softness);
    const glass=sprite(palette,accent,false,large);
    if(spin){
     ctx.save();ctx.translate(point.x,point.y);ctx.rotate(spin);
     ctx.drawImage(glass,-r,-r,r*2,r*2);ctx.restore();
    }else ctx.drawImage(glass,point.x-r,point.y-r,r*2,r*2);
   }
   ctx.globalAlpha=alpha;
  }
  function glassRibbons(point,r,phase,energy){
   if(r<17||energy<=0)return;
   ctx.save();
   ctx.translate(point.x,point.y);ctx.rotate(phase*.41);
   const alpha=ctx.globalAlpha;
   ctx.lineWidth=Math.max(.7,r*.012);
   ctx.strokeStyle=light?'#267f92':'#9df6ed';
   ctx.globalAlpha=alpha*energy*.53;
   ctx.beginPath();
   ctx.ellipse(0,0,r*.96,r*(.28+.16*Math.sin(phase)),.35,Math.PI*.07,Math.PI*.91);
   ctx.stroke();
   ctx.strokeStyle=light?'#216ba1':'#d3edff';
   ctx.globalAlpha=alpha*energy*.48;
   ctx.beginPath();
   ctx.ellipse(0,0,r*.93,r*(.47+.12*Math.cos(phase)),1.8,Math.PI*1.04,Math.PI*1.81);
   ctx.stroke();
   ctx.restore();
  }
  function polygon(coords,color){
   ctx.fillStyle=color;
   ctx.beginPath();
   for(const [index,[x,y]] of coords.entries()){
    if(index===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
   }
   ctx.closePath();ctx.fill();
  }
  function form(object){
   const {point:p,size:r,kind,blur}=object;
   if(!['claim','document','person','open'].includes(kind)||blur>6||r<5){
    orb(p,r,object.accent,blur,object.spin,object.large);
    return;
   }
   if(kind==='person'){
    orb(p,r*.81,false,blur,object.spin);
    ctx.strokeStyle=light?'#377a9e':'#80cdec';ctx.lineWidth=1.1;
    ctx.beginPath();ctx.ellipse(p.x,p.y,r,r*.70,object.spin*.19,0,Math.PI*2);ctx.stroke();
    return;
   }
   ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.sin(object.spin)*.16);
   if(kind==='open'){
    ctx.strokeStyle=light?'#a86b20':'#ffd29a';ctx.lineWidth=Math.max(2,r*.09);
    ctx.beginPath();ctx.arc(0,0,r*.82,-Math.PI*.18,Math.PI*1.42);ctx.stroke();
   }else if(kind==='claim'){
    polygon([[0,-r],[r*.8,-r*.19],[r*.42,r*.66],[0,r*.84],[-r*.69,r*.26],[-r*.72,-r*.35]],'#77cfed85');
    polygon([[0,-r],[r*.8,-r*.19],[0,0],[-r*.72,-r*.35]],'#c5eff9af');
    polygon([[0,0],[r*.8,-r*.19],[r*.42,r*.66],[0,r*.84]],'#247eadaf');
   }else{
    polygon([[-r*.65,-r*.78],[r*.38,-r*.91],[r*.70,-r*.66],[r*.70,r*.67],[-r*.65,r*.86]],'#5cabe193');
    polygon([[r*.38,-r*.91],[r*.38,-r*.57],[r*.70,-r*.66]],'#d6f3ffa8');
    ctx.strokeStyle='#ddf4ff99';ctx.lineWidth=1;
    for(const offset of [-.24,.04,.30]){
     ctx.beginPath();ctx.moveTo(-r*.40,r*offset);ctx.lineTo(r*.40,r*(offset-.11));ctx.stroke();
    }
   }
   ctx.restore();
  }
  function drawScale(chart,alpha){
   ctx.save();ctx.globalAlpha=alpha;
   ctx.lineWidth=1;
   ctx.font='11px "Geist Mono", monospace';
   ctx.textAlign='right';ctx.textBaseline='middle';
   const ticks=chart.min===chart.max?[0]:[...new Set([chart.min,chart.min+(chart.max-chart.min)/2,chart.max,0])];
   for(const value of ticks){
    const y=chart.y(value);
    ctx.strokeStyle=value===0?'#79b8deae':'#71a9d255';
    ctx.beginPath();ctx.moveTo(chart.left,y);ctx.lineTo(chart.right,y);ctx.stroke();
    ctx.fillStyle=light?'#245173':'#b6d6e8';
    ctx.fillText(String(Number(value.toPrecision(3)))+chart.unit,chart.left-7,y);
   }
   if(chart.reference!==undefined){
    ctx.setLineDash([5,5]);ctx.strokeStyle=light?'#b16a19':'#ffc382';
    ctx.beginPath();ctx.moveTo(chart.left,chart.y(chart.reference));ctx.lineTo(chart.right,chart.y(chart.reference));ctx.stroke();
   }
   ctx.restore();
  }
  function drawColumn(bar,point,alpha){
   const {halfWidth,height,zero,negative,active}=bar;
   const x=point.x, end=negative?zero+height:zero-height;
   const top=Math.min(end,zero), bottom=Math.max(end,zero);
   ctx.globalAlpha=alpha;
   const face=ctx.createLinearGradient(x-halfWidth,top,x+halfWidth,bottom+1);
   face.addColorStop(0,active?'#a4f5ed':'#84d7f9');
   face.addColorStop(1,active?'#248777':'#184d8b');
   const side=Math.min(11,halfWidth*.38);
   polygon([[x-halfWidth,top],[x+halfWidth,top],[x+halfWidth,bottom],[x-halfWidth,bottom]],face);
   polygon([[x+halfWidth,top],[x+halfWidth+side,top-side],[x+halfWidth+side,bottom-side],[x+halfWidth,bottom]],'#3078a8');
   polygon([[x-halfWidth,top],[x-halfWidth+side,top-side],[x+halfWidth+side,top-side],[x+halfWidth,top]],'#b5edff');
  }
  function branchPositions(){
   if(!inStory||story.reading||!story.branches.length)return [];
   const split=smooth(.06,.92,visualDepth);
   const leave=smooth(1.07,1.79,visualDepth);
   const lower=Math.min(viewportHeight-84,storyFrame?.bottom??viewportHeight*.87);
   const x0=core?.x??centerX,y0=core?.y??centerY;
   const span=storyFrame?.span??{left:0,width};
   return story.branches.map((branch,index)=>{
    const stagger=smooth(.06+index*.05,.91,visualDepth);
    const x=span.left+span.width*(.5+(index-1)*(span.width<600?.275:.23));
    const y=lower-(index===1?29:49);
    const emerge=animate?split:1;
    const collapse=index===1?0:leave;
    const scatter=animate?collapse*span.width*.085*(index-1):0;
    return {x:x0+(x-x0)*emerge+scatter,y:y0+(y-y0)*emerge,
     scale:animate?.63+stagger*.37-collapse*.17:1,opacity:stagger*(1-leave)};
   });
  }
  function drawBranchPaths(lanes){
   if(!lanes.length||!core)return;
   ctx.save();
   ctx.lineWidth=1;
   for(const [index,lane] of lanes.entries()){
    if(lane.opacity<.05)continue;
    const bend=(index-1)*38;
    ctx.globalAlpha=lane.opacity*.47;
    ctx.strokeStyle=light?'#326b8f':index===1?'#a1f8e4':'#84c6ef';
    ctx.beginPath();ctx.moveTo(core.x,core.y);
    ctx.bezierCurveTo(core.x+bend,core.y+35,lane.x-bend,lane.y-42,lane.x,lane.y);
    ctx.stroke();
   }
   ctx.restore();
  }
  function drawFigure(figure,lanes){
   if(!animate||!figure||!lanes[1])return;
   const appear=smooth(1.22,1.52,visualDepth);
   const fall=smooth(1.59,1.96,visualDepth);
   const opacity=appear*(1-smooth(1.79,1.98,visualDepth));
   if(opacity<.02)return;
   const origin=lanes[1], {text,point,bar}=figure;
   const dots=figureMask(text);
   ctx.save();
   ctx.fillStyle=light?'#1c6d8d':'#befff1';
   ctx.globalAlpha=opacity*.91;
   for(const [index,[x,y]] of dots.entries()){
    const scatter=(1-appear)*29;
    const laneX=point.x+x*.17, laneY=bar.zero-bar.height*(index%13)/13;
    const textY=Math.max((storyFrame?.top??50)+53,origin.y-68);
    const startX=origin.x+x+Math.sin(index*3.71)*scatter;
    const startY=textY+y+Math.cos(index*5.13)*scatter;
    ctx.fillRect(startX+(laneX-startX)*fall,startY+(laneY-startY)*fall,1.7,1.7);
   }
   ctx.restore();
  }
  const fog=ctx.createRadialGradient(centerX,centerY,0,centerX,centerY,Math.min(width,viewportHeight)*.53);
  fog.addColorStop(0,light?'#89b9e082':blue?'#2557a083':'#19387985');fog.addColorStop(1,'#0000');
  ctx.fillStyle=fog;ctx.fillRect(0,0,width,viewportHeight);
  ctx.fillStyle=light?'#306e9b':'#a5d7ff';
  for(const mote of motes){
   const sway=elapsed*.24+mote.phase;
   const point=project(Math.cos(mote.angle)*mote.radius+Math.sin(sway)*.56,
    mote.y+Math.cos(sway)*.5,Math.sin(mote.angle)*mote.radius);
   if(!point||point.x<0||point.x>width||point.y<0||point.y>viewportHeight)continue;
   const size=Math.max(.48,Math.min(2.8,mote.size*point.scale));
   const blur=defocus(point);
   ctx.globalAlpha=mote.alpha*Math.min(1,18/point.distance);
   if(blur>5&&mote.size>.023){
    const radius=size+blur*.38;
    ctx.drawImage(sprite(palette,false,true),point.x-radius,point.y-radius,radius*2,radius*2);
   }else{
    ctx.globalAlpha*=Math.max(.23,1-blur/26);
    ctx.beginPath();ctx.arc(point.x,point.y,size,0,Math.PI*2);ctx.fill();
   }
  }
  ctx.globalAlpha=1;
  const objects=[];
  for(const bubble of bubbles){
   const angle=bubble.angle+elapsed*bubble.speed;
   const radius=bubble.radius+Math.sin(elapsed*.38+bubble.phase)*.7;
   const y=bubble.y+Math.cos(elapsed*.49+bubble.phase)*1.2;
   const point=project(Math.cos(angle)*radius,y,Math.sin(angle)*radius);
   if(!point)continue;
   const size=Math.min(90,bubble.size*point.scale);
   const fade=Math.min(1,point.distance/4,30/point.distance);
   objects.push({point,size,accent:bubble.accent,blur:defocus(point),
    alpha:bubble.alpha*fade*(inStory?.39:.75)});
  }
  const projections=[];
  let core;
  let figure;
  let refracted=false;
  let selectedPoint;
  const connected=[];
  const projectedEdges=[];
  const selectedIds=new Set(inStory?story.layers[story.active]?.nodes[story.selected]?.ids:[]);
  if(inStory){
   for(const [layerIndex,layer] of story.layers.entries()){
    const gap=layerIndex-visualDepth, active=layerIndex===story.active;
    const near=Math.max(0,1-Math.abs(gap)/.85);
    const chart=near&&layer.visual&&!story.reading?measurementLayout(layer,width,viewportHeight,storyFrame):null;
    const blend=chart?near*near*(3-2*near):0;
    const layerPoints=[];
    if(blend>.01)drawScale(chart,blend);
    if(storyFrame?.hubRadius&&Math.abs(gap)<1.25&&(active||dockBlend<.2)){
     const phase=elapsed*.57+layerIndex*.84;
     const point=project(gap*1.95+Math.sin(phase)*.16,-layerIndex*11+Math.cos(phase*.8)*.19,
      Math.cos(phase*.8)*.14-gap*.70);
     if(point){
      const growth=Math.max(.59,Math.min(1.20,9/point.distance));
      let radius=storyFrame.hubRadius*(growth+(active?arrival*.055:0));
      if(active&&dockPosition){
       point.x+=(dockPosition.x-point.x)*dockBlend;
       point.y+=(dockPosition.y-point.y)*dockBlend;
       radius+=(dockPosition.radius-radius)*dockBlend;
      }
      const alpha=Math.max(0,1-Math.abs(gap)*.73)*readerFade*(1-blend);
      objects.push({point,size:radius,accent:layerIndex%2===1,blur:Math.min(6,Math.abs(gap)*5),
       lens:active,
       spin:phase,alpha,large:true,ribbons:.7+(active?arrival*.3:0)});
      if(active)core={x:point.x,y:point.y,scale:radius/storyFrame.hubRadius};
     }
    }
    for(const [index,node] of layer.nodes.entries()){
     const {pose:{x,y,z},highlight}=story.motion[layerIndex][index];
     const point=project(x,y,z);
     if(!point)continue;
     layerPoints[index]=point;
     const selected=layerIndex===story.active&&index===story.selected;
     const layerWeight=Math.exp(-Math.abs(layerIndex-visualDepth)*1.65);
     const maxRadius=Math.min(135,width*(wide?.11:.19),selected?viewportHeight*.14:Infinity);
     const radius=Math.min(maxRadius,Math.max(active?21:0,(.30+layerWeight*.17+highlight*.12)*point.scale));
     const blur=selected?0:defocus(point)*(.36+focusBlend*.58)+focusBlend*3;
     if(selected)selectedPoint=point;
     else if(node.kind==='document'&&node.ids.some(id=>selectedIds.has(id)))connected.push(point);
     const amount=Number.isFinite(node.amount), column=amount&&node.kind==='measurement'&&blend>0;
     const reference=amount&&node.kind==='reference'&&blend>0;
     let bar, base;
     if(column||reference){
      const axisX=reference?chart.right+12:chart.left+(index+.5)*chart.step;
      const axisY=chart.y(node.amount)-(column?24:0);
      point.x+=(axisX-point.x)*blend;
      point.y+=(axisY-point.y)*blend;
      if(column){
       const zero=point.y+(chart.zero-axisY)*blend;
       const height=Math.max(1,Math.abs(chart.zero-chart.y(node.amount))*blend);
       bar={zero,height,negative:node.amount<0,halfWidth:Math.min(32,chart.step*.29),active:highlight>.15};
       base=point.y+(chart.bottom+13-axisY)*blend;
       if(chart.reference!==undefined&&layer.visual.reference?.label.toLowerCase().includes(node.label.toLowerCase())){
        figure={text:node.value,point,bar};
       }
      }
     }
     const opacity=selected?1:(.2+layerWeight*.8)*(1-focusBlend*.47);
     objects.push({point,size:radius,kind:node.kind,highlight,blur,spin:active?yaw*.68+elapsed*.36+index*.91:0,
      accent:node.kind==='reference'||node.kind==='evidence'||highlight>.18,
      ribbons:active&&(!node.kind||node.kind==='evidence') ? .34+highlight*.42 : 0,
      alpha:opacity*(1-blend),bar,barAlpha:opacity*blend});
     const presence=(1-Math.abs(layerIndex-visualDepth)*.67)*(active?1:1-focusBlend*.92);
     if(blend>.68&&!column&&!reference)continue;
     if(presence>.06||selected)projections.push({
      layer:layerIndex,index,x:point.x,y:point.y,radius:blend>.5?12:radius,
      presence:selected?1:Math.max(.08,presence),
      ...(blend>.5&&column?{chart:true,base,barHeight:bar.height}:{}),
      ...(blend>.5&&reference?{reference:true,base:point.y+12}:{}),
     });
    }
    for(const [from,to,role] of layer.edges||[]){
     if(layerPoints[from]&&layerPoints[to])projectedEdges.push([layerPoints[from],layerPoints[to],near,role]);
    }
   }
  }
  const lanes=branchPositions();
  drawBranchPaths(lanes);
  for(const [from,to,opacity,role] of projectedEdges){
   ctx.globalAlpha=opacity*(story.reading ? .22 : .65);
   const challenges=role==='challenges';
   ctx.setLineDash(challenges?[5,5]:[]);
   ctx.strokeStyle=challenges?(light?'#955b24':'#ffd09b'):
    role==='supports'?(light?'#127668':'#8fe7d3'):(light?'#2c6586':'#7fbed9');
   ctx.lineWidth=1.2;
   ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
   if(role==='quoted'||role==='reply'){
    const dx=to.x-from.x,dy=to.y-from.y,angle=Math.atan2(dy,dx);
    const x=from.x+dx*.65,y=from.y+dy*.65;
    ctx.beginPath();
    ctx.moveTo(x-7*Math.cos(angle-.55),y-7*Math.sin(angle-.55));
    ctx.lineTo(x,y);
    ctx.lineTo(x-7*Math.cos(angle+.55),y-7*Math.sin(angle+.55));
    ctx.stroke();
   }
  }
  ctx.setLineDash([]);
  if(selectedPoint){
   ctx.globalAlpha=1;
   ctx.strokeStyle=light?'#167b905a':'#7be4d95a';ctx.lineWidth=1.2;
   for(const source of connected){
    ctx.beginPath();ctx.moveTo(selectedPoint.x,selectedPoint.y);ctx.lineTo(source.x,source.y);ctx.stroke();
   }
  }
  objects.sort((a,b)=>b.point.distance-a.point.distance);
  for(const object of objects){
   ctx.globalAlpha=object.alpha;
   if(object.alpha>.01){
    const {point,size,spin,accent}=object;
    const visible=point.x-size>=0&&point.x+size<=width&&point.y-size>=0&&point.y+size<=viewportHeight;
    if(object.lens&&visible&&object.alpha>.5){
     refracted=drawOptics?.(canvas,ctx,point,size,scale,spin,light,accent)===true;
    }
    if(!object.lens||!refracted)form(object);
   }
   if(object.bar)drawColumn(object.bar,object.point,object.barAlpha);
   if(object.ribbons)glassRibbons(object.point,object.size,object.spin,object.ribbons);
   if(object.highlight>.02){
    const {point,size,highlight}=object;
    ctx.globalAlpha=highlight*.65;
    ctx.strokeStyle=light?'#2c887c':'#b4f9ed';ctx.lineWidth=1.25;
    ctx.beginPath();ctx.arc(point.x,point.y,size+5+highlight*4,0,Math.PI*2);ctx.stroke();
   }
  }
  drawFigure(figure,lanes);
  if(core&&arrival>0&&readerFade>.6){
   ctx.globalAlpha=arrival*.50;
   ctx.strokeStyle=light?'#3090a4':'#a7f1fb';ctx.lineWidth=1.3;
   ctx.beginPath();
   ctx.arc(core.x,core.y,storyFrame.hubRadius*(1+(1-arrival)*.34),0,Math.PI*2);
   ctx.stroke();
  }
  if(core){
   story.coreLabel??={...core};
   const tracking=animate?1-Math.exp(-dt*13):1;
   for(const key of ['x','y','scale'])story.coreLabel[key]+=(core[key]-story.coreLabel[key])*tracking;
   core={...story.coreLabel};
  }
  ctx.globalAlpha=1;
  canvas.classList.add('is-rendered');
  story?.onProject(projections,{core,depth:visualDepth,arrival,branches:lanes,refracted});
  if(animate)request();
 }
 pause.hidden=reduced.matches;
 pause.onclick=()=>{
  paused=!paused;
  root.dataset.motion=paused?'paused':'running';
  pause.textContent=paused?'Resume motion':'Pause motion';
  request();
 };
 reduced.addEventListener('change',()=>{pause.hidden=reduced.matches;request();});
 new ResizeObserver(request).observe(canvas);
 new MutationObserver(request).observe(main,{attributes:true,attributeFilter:['data-view']});
 new MutationObserver(request).observe(root,{attributes:true,attributeFilter:['data-theme']});
 document.addEventListener('visibilitychange',request);
 request();
 return {
  show(layers,onProject,branches=[]){
   const motion=layers.map(layer=>layer.nodes.map(()=>({time:0,highlight:0})));
   story={layers,motion,onProject,branches,active:0,arrived:0,selected:-1,hovered:-1};
   depth=visualDepth=arrival=dockBlend=0;readerFade=1;dockPosition=undefined;request();
  },
  move(level,active){
   depth=level;
   if(story&&story.active!==active){story.active=active;story.selected=story.hovered=-1;}
   request();
  },
  frame(top,bottom,focusY,hubRadius,dock,span){
   if(story){
    if(bottom>top+80)story.frame={top,bottom,focusY,hubRadius,dock,span};
    else if(story.frame)Object.assign(story.frame,{focusY,dock,span,clipTop:top,clipBottom:bottom});
    else story.frame={top,bottom:dock?dock.y+80:bottom,focusY,hubRadius,dock,span,clipTop:top,clipBottom:bottom};
   }
   request();
  },
  replaceNodes(index){
   if(!story)return;
   story.motion[index]=story.layers[index].nodes.map(()=>({time:0,highlight:0}));
   if(story.active===index)story.selected=story.hovered=-1;
   request();
  },
  select(index){if(story)story.selected=index;request();},
  read(reading){if(story)story.reading=reading;request();},
  hover(index){if(story)story.hovered=index;request();},
  rotate(horizontal,vertical=0){
   targetYaw+=horizontal;
   targetPitch=Math.max(-.46,Math.min(.46,targetPitch+vertical));
   request();
  },
  clear(){story=null;depth=visualDepth=0;targetYaw=0;targetPitch=.13;request();},
 };
}
