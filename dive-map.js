function bubblePreview(point){
 const text=(point.preview||point.detail||point.takeaway||point.context||'').trim();
 if(text.length<=116)return text;
 const phrase=text.match(/^.{18,116}?[.!?](?=\s|$)/s)?.[0];
 return phrase||text.slice(0,113).replace(/\s+\S*$/,'')+'…';
}

function bubbleGraphic(chart){
 const graphic=el('span',null,'bubble-graphic');
 graphic.setAttribute('aria-hidden','true');
 const values=chart.values.slice(0,7);
 const floor=Math.min(0,...values.map(mark=>mark.value),chart.reference?.value||0);
 const ceiling=Math.max(0,...values.map(mark=>mark.value),chart.reference?.value||0);
 const scale=ceiling-floor||1;
 graphic.style.setProperty('--bars',values.length);
 for(const [index,mark] of values.entries()){
  const bar=el('i');
  bar.style.left=(index*100/values.length)+'%';
  bar.style.height=(Math.abs(mark.value)/scale*100)+'%';
  bar.style.bottom=((Math.min(0,mark.value)-floor)/scale*100)+'%';
  graphic.append(bar);
 }
 return graphic;
}

function renderDiveMap(parent,layers,active,onLayer,onBubble,paths){
 const layout=el('div',null,'dive-map-layout');
 const arena=el('div',null,'dive-map-arena');
 const status=el('div',null,'dive-map-waterline');
 status.append(el('span','Surface'),el('span',layers.length+' '+(layers.length===1?'layer':'layers')));
 const space=el('div',null,'dive-map-space');
 const list=el('ol',null,'dive-map-layers');
 list.setAttribute('aria-label','Story layers');
 const inspector=el('section',null,'dive-map-inspector');
 inspector.tabIndex=0;
 inspector.setAttribute('aria-label','Selected layer');
 const detail=el('div',null,'dive-map-selection');
 inspector.append(detail,paths);
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const buttons=layers.map((layer,index)=>{
  const row=el('li',null,'dive-map-layer');
  row.style.setProperty('--depth',index);
  row.style.setProperty('--span',(74+26*index/Math.max(1,layers.length-1))+'%');
  const button=el('button',null,'dive-map-jump');
  button.type='button';
  button.setAttribute('aria-label','Layer '+(index+1)+' · '+layer.name+' · '+layer.title);
  if(index===active)button.setAttribute('aria-current','step');
  const crystal=el('span',null,'dive-map-crystal');
  crystal.setAttribute('aria-hidden','true');
  crystal.append(el('span',null,'dive-map-face'),el('span',null,'dive-map-edge'));
  const words=el('span',null,'dive-map-label');
  words.append(el('span',layer.name,'dive-map-kind'),el('strong',layer.title));
  const glyph=el('span',null,'dive-map-glyph');
  glyph.setAttribute('aria-hidden','true');
  if(layer.visual)glyph.append(bubbleGraphic(layer.visual));
  else for(let i=0;i<Math.min(3,layer.nodes.length);i++)glyph.append(el('i'));
  button.append(crystal,el('span',String(index+1).padStart(2,'0'),'dive-map-number'),words,glyph);
  button.onclick=()=>{
   select(index);
   if(typeof inspector.scrollIntoView==='function'&&getComputedStyle(layout).display==='block'){
    inspector.scrollIntoView({block:'nearest',behavior:reduce.matches?'instant':'smooth'});
   }
  };
  row.append(button);list.append(row);
  return button;
 });
 function select(index){
  const layer=layers[index];
  if(!layer)return;
  buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  const summary=el('div',null,'dive-map-summary');
  summary.append(el('p','Layer '+(index+1)+' / '+layers.length+' · '+layer.name,'kicker'),
   el('h4',layer.title));
  if(layer.takeaway)summary.append(el('p',layer.takeaway,'dive-map-takeaway'));
  const enter=el('button','Open layer '+(index+1)+' ↓','primary dive-map-enter');
  enter.onclick=()=>onLayer(index);
  summary.append(enter);
  if(layer.nodes.length){
   summary.append(el('h5',layer.nodes.length+' '+(layer.nodes.length===1?'bubble':'bubbles')));
   const picks=el('ul',null,'dive-map-bubbles');
   for(const [nodeIndex,node] of layer.nodes.entries()){
    const item=el('li'), button=el('button',null,'dive-map-bubble');
    button.append(el('span',node.role,'meta'),el('strong',node.label));
    button.onclick=()=>onBubble(index,nodeIndex);
    item.append(button);picks.append(item);
   }
   summary.append(picks);
  }
  detail.replaceChildren(summary);
  inspector.scrollTop=0;
 }
 list.addEventListener('keydown',event=>{
  const index=buttons.indexOf(event.target);
  if(index<0)return;
  const next={ArrowUp:index-1,ArrowDown:index+1,Home:0,End:buttons.length-1}[event.key];
  if(next===undefined)return;
  event.preventDefault();
  const selected=Math.max(0,Math.min(buttons.length-1,next));
  select(selected);buttons[selected].focus();
 });
 space.addEventListener('pointermove',event=>{
  if(event.pointerType!=='mouse'||reduce.matches||document.documentElement.dataset.motion==='paused')return;
  const bounds=space.getBoundingClientRect();
  space.style.setProperty('--map-pitch',((.5-(event.clientY-bounds.top)/bounds.height)*6)+'deg');
  space.style.setProperty('--map-yaw',(((event.clientX-bounds.left)/bounds.width-.5)*10)+'deg');
 });
 space.addEventListener('pointerleave',()=>{
  space.style.setProperty('--map-pitch','0deg');space.style.setProperty('--map-yaw','0deg');
 });
 space.append(list);arena.append(status,space);
 layout.append(arena,inspector);parent.replaceChildren(layout);
 select(Math.max(0,active));
}

function quoteRelationships(report){
 const posts=report.dossier.posts;
 const submitted=posts.find(post=>post.evidence_ids.includes(report.evidence_id));
 if(!submitted)return [];
 const quoted=posts.filter(post=>post!==submitted&&/quoted by the original post/i.test(post.relationship));
 const replies=posts.filter(post=>post!==submitted&&/\breply to the original post\b/i.test(post.relationship));
 return [...quoted.map(post=>({post,edge:'Quoted by the submitted post'})),{post:submitted,edge:'Submitted post'},
  ...replies.map(post=>({post,edge:'Reply to the submitted post'}))];
}

function renderQuoteTrail(report,active,openPost){
 const trace=quoteRelationships(report);
 if(trace.length<2)return null;
 const figure=el('figure',null,'quote-trail');
 figure.append(el('figcaption','How the posts connect'),
  el('p','The links show quoting and replying. Each row summarizes a captured post.','meta'));
 const list=el('ol');
 for(const {post,edge} of trace){
  const item=el('li');
  const button=el('button',post.author);
  button.onclick=()=>openPost(post,button);
  if(post===active)item.dataset.current='true';
  item.append(el('span',edge,'quote-edge'),button,el('p',post.summary));
  list.append(item);
 }
 figure.append(list);
 return figure;
}

function renderClaimConnections(report,ids,openClaim){
 const links=new Set(ids);
 const items=report.dossier.claims.flatMap(claim=>{
  const linked=[...new Set(claim.evidence_ids.filter(id=>links.has(id)))];
  if(!linked.length)return [];
  const roles=new Set(linked.flatMap(id=>{
   const annotated=claim.evidence?.filter(item=>item.evidence_id===id).map(item=>item.role);
   return annotated?.length?annotated:['unclassified'];
  }));
  return [{claim,roles,linked}];
 });
 if(!items.length)return null;
 const figure=el('figure',null,'source-connections');
 figure.append(el('figcaption','What these sources connect to'));
 const list=el('ul');
 for(const {claim,roles,linked} of items){
  const row=el('li');
  const kinds=el('div',null,'connection-roles');
  for(const role of roles){
   const tag=el('span',proofRoles[role]);tag.dataset.role=role;kinds.append(tag);
  }
  const button=el('button',claim.claim);
  button.onclick=()=>openClaim(claim,button);
  row.append(kinds,button,el('small',claimStatus(claim)+' · '+linked.length+' linked '+(linked.length===1?'record':'records')));
  list.append(row);
 }
 figure.append(list);
 return figure;
}

function researchPrompts(report){
 const prompts=[];
 if(report.dossier.comparisons.length&&report.dossier.claims.some(claim=>claim.verdict==='unresolved')){
  prompts.push({title:'Find a fair head-to-head test',question:'Is there a directly comparable test for an unresolved performance claim? Use matched settings and identify any remaining differences.'});
 }
 if(report.dossier.charts.some(chart=>chart.reference)){
  prompts.push({title:'Check whether the number changed',question:'Is there a newer comparable measurement for the figure discussed in this story? Keep the denominator and reporting period explicit.'});
 }
 if(report.dossier.gaps.length){
  prompts.push({title:'Investigate an evidence gap',question:'What public evidence could resolve this gap? '+report.dossier.gaps[0].slice(0,720)});
 }
 if(report.dossier.participants.length>1){
  prompts.push({title:'Look for independent coverage',question:'Which parts of this exchange can be corroborated by independent primary sources? Separate coverage that cites the same source from independent evidence.'});
 }
 return prompts;
}
