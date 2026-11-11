function claimBubble(claim,index=0){
 const status=claimStatus(claim);
 return {label:claim.claim,value:String(index+1),role:status[0].toUpperCase()+status.slice(1),
  detail:claim.reason,context:claim.speaker,ids:claim.evidence_ids,claim,
  kind:claim.verdict==='unresolved'?'open':'claim'};
}

function cloudLayers(report) {
 const d=report.dossier, sources=Object.values(report.sources), layers=[];
 const anchor=d.posts.find(post=>post.evidence_ids.includes(report.evidence_id));
 const exchanges=anchor?[anchor,...d.posts.filter(post=>post!==anchor)]:d.posts;
 if(exchanges.length||d.summary){
  const nodes=exchanges.slice(0,8).map(post=>{
   const relationship=post.relationship.toLowerCase();
   const role=post===anchor?'Submitted post':relationship.includes('quoted by')?'Quoted post':
    /\brepl(y|ies|ied|ying)\b/.test(relationship)?'Reply':'Related post';
   const person=d.participants.find(item=>item.handle===post.author);
   return {label:post.author,value:role==='Quoted post'?'Quote':role==='Reply'?'Reply':'Post',role,person,post,kind:'document',
    detail:post.summary,context:post.relationship,ids:post.evidence_ids};
  });
  const submitted=nodes.findIndex(node=>node.post===anchor);
  const edges=quoteRelationships(report).flatMap(({post,edge})=>{
   const index=nodes.findIndex(node=>node.post===post);
   if(submitted<0||index<0||submitted===index)return [];
   return [[index,submitted,edge.startsWith('Quoted')?'quoted':'reply']];
  });
  layers.push({
   name:'Story',title:'What started the story',
   takeaway:d.summary||anchor?.summary||exchanges[0]?.summary,
   guide:nodes.length?'Explore the posts around this story.':'Explore the submitted source.',
   context:anchor?[anchor.author,anchor.summary].join(' · '):exchanges[0]?.summary,
   ids:anchor?.evidence_ids||exchanges[0]?.evidence_ids||[],
   chapter:exchanges.length>1?'exchanges':'The starting point',
   action:exchanges.length>1?'Read the exchanges':'Read the story',nodes,edges,
  });
 }
 const chart=d.charts.find(item=>item.values.length);
 if(chart){
  const format=value=>String(value)+(chart.unit==='%'?'%':chart.unit?' '+chart.unit:'');
  const reference=chart.reference;
  const matching=reference&&chart.values.find(mark=>
   reference.label.toLowerCase().includes(mark.label.toLowerCase()));
  const first=chart.values[0];
  const context=[chart.period,chart.caveat].filter(Boolean).join(' · ');
  const nodes=chart.values.slice(0,7).map(mark=>({
   label:mark.label,value:format(mark.value),amount:mark.value,kind:'measurement',role:'Measured value',detail:format(mark.value)+' · '+chart.title,
   context,ids:chart.evidence_ids,measurement:mark,preview:chart.period,
  }));
  if(reference)nodes.push({
   label:reference.label,value:format(reference.value),amount:reference.value,role:'Reference figure',kind:'reference',
   detail:reference.label+' · '+format(reference.value),context,ids:chart.evidence_ids,measurement:reference,
  });
  layers.push({
   name:'Measurements',title:chart.title,
   takeaway:matching
    ? matching.label+' · '+format(matching.value)+' in the data vs. '+format(reference.value)+' for the reference figure.'
    : first.label+' · '+format(first.value)+(chart.period?' · '+chart.period:''),
   guide:[chart.period,reference?'Dashed line shows the reference figure.':'Select a column to inspect its sources.'].filter(Boolean).join(' · '),
   context,ids:chart.evidence_ids,chapter:'The numbers behind the story',action:'Open charts and comparisons',
   visual:chart,visualTitle:'Open chart',nodes,
  });
 }
 if(d.comparisons.length){
  const comparison=d.comparisons[0];
  const nodes=comparison.rows.slice(0,8).map(row=>({
   label:row[0],value:'↔',role:'Comparison item',detail:row[1]||row[0],
   context:row.slice(2).map((value,index)=>[comparison.columns[index+2],value].filter(Boolean).join(' · ')).join('\n'),
   ids:comparison.evidence_ids,
  }));
  layers.push({
   name:'Comparison',title:comparison.title,
   takeaway:[nodes[0]?.label,nodes[0]?.detail].filter(Boolean).join(' · '),
   guide:'Select an item to see which details have been verified and what still needs to be measured.',
   context:comparison.columns.join(' · '),ids:comparison.evidence_ids,
   chapter:'The numbers behind the story',action:'Open the full comparison',comparison,nodes,
  });
 }
 if(d.claims.length){
  const focus=d.claims.find(claim=>claim.verdict!=='unresolved')||d.claims[0];
  const nodes=d.claims.slice(0,8).map(claimBubble);
  layers.push({
   name:'Claim checks',title:'What the evidence settles',
   takeaway:focus.claim+' · '+focus.verdict,context:focus.reason,ids:focus.evidence_ids,
   guide:'Each bubble is a claim. Its label shows the verdict, and the evidence explains the reasoning.',
   chapter:'What the evidence settles',action:'Trace the argument map',nodes,
  });
 }
 if(d.participants.length){
  const people=d.participants.slice(0,5).map(person=>({
   label:person.handle,role:'Participant',detail:person.position,value:person.handle.replace(/^@/,'').slice(0,2).toUpperCase(),
   person,kind:'person',
   ids:[...new Set([
    ...d.posts.filter(post=>post.author===person.handle).flatMap(post=>post.evidence_ids),
    ...(person.role_in_story?.evidence_ids||[]),...(person.public_context?.evidence_ids||[]),
   ])],
  }));
  const attributed=people.flatMap(({person})=>d.claims.filter(claim=>
   claim.speaker===person.handle&&claim.attribution!=='inferred').slice(0,1)).slice(0,3);
  const nodes=[...people,...attributed.map(claimBubble)];
  const edges=attributed.map((claim,index)=>[people.findIndex(node=>node.person.handle===claim.speaker),people.length+index]);
  const chapter=d.participants.length>1?'How the perspectives differ':'Who is speaking';
  layers.push({
   name:'Perspectives',title:chapter,takeaway:nodes[0].label+' · '+nodes[0].detail,
   guide:'Select a person to see their position and the captured posts behind it.',
   context:nodes.slice(1,3).map(node=>node.label+' · '+node.detail).join('\n\n'),
   ids:people.slice(0,3).flatMap(node=>node.ids),chapter,action:'Open participant histories',nodes,edges,
  });
 }
 if(sources.length){
  const host=source=>new URL(source.article_url).hostname.replace(/^www\./,'');
  const checked=leadClaims(report).filter(claim=>claim.evidence?.some(link=>
   ['supports','challenges'].includes(link.role))).slice(0,2);
  const proofIds=[...new Set(checked.flatMap(claim=>claim.evidence.filter(link=>
   ['supports','challenges'].includes(link.role)).map(link=>link.evidence_id)))];
  const focus=proofIds.map(id=>report.sources[id]).filter(Boolean).slice(0,5);
  const chosen=focus.length?focus:sources.slice(0,8);
  const documents=chosen.map(source=>({
   label:source.title||host(source),role:host(source),detail:source.excerpt,
   context:[host(source),source.date_utc?.slice(0,10)].filter(Boolean).join(' · '),
   value:host(source).slice(0,3).toUpperCase(),ids:[source.id],kind:'document',
  }));
  const claims=checked.map(claimBubble);
  const nodes=[...claims,...documents];
  const edges=checked.flatMap((claim,index)=>claim.evidence.flatMap(link=>{
   const target=chosen.findIndex(source=>source.id===link.evidence_id);
   return target<0||!['supports','challenges'].includes(link.role)
    ?[]:[[index,claims.length+target,link.role]];
  }));
  if(edges.length){
   claims.forEach((node,index)=>{node.lane={side:-1,index,count:claims.length};});
   documents.forEach((node,index)=>{node.lane={side:1,index,count:documents.length};});
  }
  const hosts=[...new Set(sources.map(host))];
  layers.push({
   name:'Sources',title:'Where the story comes from',
   takeaway:sources.length+' evidence '+(sources.length===1?'record':'records')+' · '+hosts.slice(0,4).join(', '),
   guide:edges.length?'Solid lines show supporting evidence. Dashed lines show evidence that challenges a claim.'
    :'Select a source to read its captured excerpt and open the original.',
   context:'Select a document to inspect the captured evidence and open the original source.',
   ids:sources.map(source=>source.id),action:'Browse all evidence',nodes,edges,
  });
 }
 if(d.gaps.length||d.opportunities.length){
  const open=d.claims.filter(claim=>claim.verdict==='unresolved');
  const nodes=[
   ...d.gaps.map((gap,index)=>({label:gap,role:'Evidence gap',value:String(index+1),detail:gap,ids:[],kind:'open'})),
   ...d.opportunities.map((next,index)=>({label:next,role:'Research lead',value:'↗',detail:next,ids:[]})),
  ].slice(0,8);
  layers.push({
   name:'What’s open',title:'What would move the story forward',
   takeaway:d.gaps[0]||d.opportunities[0],
   guide:'Evidence gaps show what is missing. Research leads suggest how to fill them.',
   context:[...open.map(claim=>claim.reason),...d.opportunities].join('\n\n'),
   ids:open.flatMap(claim=>claim.evidence_ids),
   chapter:'What is still open',action:'Open research leads',nodes,
  });
 }
 return layers;
}

function learningChapters(report){
 const evidence=cloudLayers(report);
 const route=report.dossier.learning_path;
 if(!route?.length)return evidence;
 const names={story:'Story',perspectives:'Perspectives',measurements:'Measurements',comparison:'Comparison',
  claims:'Claim checks',sources:'Sources',open:'What’s open',synthesis:'Takeaway'};
 const chapters=route.map(step=>{
  const name=names[step.focus];
  const base=evidence.find(layer=>layer.name===name);
  const gaps=evidence.find(layer=>layer.name==='What’s open');
  const nodes=[...(base?.nodes||(step.focus==='synthesis'?gaps?.nodes.filter(node=>node.role==='Research lead').slice(0,1):[])||[])];
  if(step.focus==='comparison'||step.focus==='synthesis'){
   const open=leadClaims(report).find(claim=>claim.verdict==='unresolved');
   if(open)nodes.unshift(claimBubble(open));
  }
  return {...base,name,title:step.question,takeaway:step.answer,
   context:step.why_it_matters,concepts:step.concepts||[],guided:true,guide:'',
   ids:[...new Set([...(base?.ids||[]),...step.evidence_ids])],nodes,
   action:base?.action||'Read the research leads',chapter:base?.chapter||gaps?.chapter};
 });
 for(const name of ['Sources','What’s open']){
  const layer=evidence.find(item=>item.name===name);
  if(layer&&!chapters.some(chapter=>chapter.name===name))chapters.push({...layer,detour:true});
 }
 return chapters;
}

function withEvidence(layer,sources){
 const ids=[...new Set([...layer.ids,...layer.nodes.flatMap(node=>[
  ...node.ids,...(node.person?.role_in_story?.evidence_ids||[]),...(node.person?.public_context?.evidence_ids||[]),
 ])])];
 if(!ids.length||layer.name==='Sources')return;
 const hosts=[...new Set(ids.map(id=>sources[id]?.article_url).filter(Boolean).map(url=>new URL(url).hostname.replace(/^www\./,'')))];
 const links=ids.length+' linked '+(ids.length===1?'record':'records');
 layer.nodes.push({label:'Source trail',value:String(ids.length),role:'Source records',
  kind:'evidence',preview:hosts.slice(0,2).join(' · ')||links,
  detail:links+(hosts.length?' across '+hosts.length+' '+(hosts.length===1?'site.':'sites.'):' for this layer.'),ids});
}

function argumentBranches(layers){
 const perspectives=layers.findIndex(layer=>layer.name==='Perspectives');
 const concepts=layers[perspectives]?.concepts?.map(item=>item.label.toLowerCase())||[];
 const branches=[
  {label:'Performance',concept:'speed',target:layers.findIndex(layer=>layer.name==='Comparison')},
  {label:'Ownership',concept:'popularity',target:layers.findIndex(layer=>layer.name==='Measurements')},
  {label:'Cost',concept:'price',target:layers.findIndex(layer=>layer.name==='What’s open')},
 ];
 if(layers[0]?.name!=='Story'||perspectives!==1||branches.some(branch=>branch.target<0||!concepts.includes(branch.concept)))return [];
 return branches;
}

function renderDataCloud(report, notes) {
 const layers=learningChapters(report);
 const branches=argumentBranches(layers);
 const followUps={name:'Follow-ups',title:'What your questions uncovered',nodes:[],
  takeaway:'Ask a question to explore another part of this story.',
  guide:'Sourced findings from your answers appear here as bubbles.',ids:[],action:'Read the discussion'};
 const followIndex=layers.push(followUps)-1;
 let routeLength=followIndex;
 layers.forEach(layer=>withEvidence(layer,report.sources));
 const track=el('section',null,'journey'), stage=el('div',null,'journey-stage');
 const appHeader=document.querySelector?.('body > header');
 track.style.setProperty('--layers',routeLength);
 const title=el('p',report.dossier.title,'journey-story-title'), label=el('p',null,'kicker'), heading=el('h2',null,'journey-chapter-title');
 const takeaway=el('p',null,'journey-takeaway');
 const guide=el('p',null,'journey-guide');
 const contextButton=el('button',null,'journey-hub-orb');
 const hubAction=el('small','Open story ↗','journey-hub-action');
 const hubMeta=el('span',null,'journey-hub-meta');
 const chartReader=el('button',null,'journey-chart-reader');
 chartReader.hidden=true;
 contextButton.append(hubAction,hubMeta);
 const hub=el('div',null,'journey-hub');
 const visualButton=el('button',null,'journey-context');
 const matrixButton=el('button','Evidence matrix','journey-context');
 const quick=el('nav',null,'journey-quick-read');
 const authored=layers[0]?.guided;
 quick.setAttribute('aria-label',authored?'Choose a question':'Start with these claims');
 const original=report.sources[report.evidence_id];
 if(original){
  const source=link(original.article_url);
  source.textContent='Open original ↗';quick.append(source);
 }
 if(authored){
  for(const [offset,chapter] of layers.slice(1,4).entries()){
   const button=el('button',chapter.title);
   button.onclick=()=>readDepth(offset+1);quick.append(button);
  }
 }
 for(const claim of authored?[]:leadClaims(report).slice(0,2)){
  const button=el('button');
  button.dataset.verdict=claim.verdict;
  button.append(el('span',claimStatus(claim),'meta'),el('strong',claim.claim));
  const match=matchedClaimMeasurement(claim,report.dossier.charts);
  if(match)button.append(el('small',measurementLabel(match.measured,match.chart.unit)+' measured'));
  button.onclick=()=>inspect(claimBubble(claim),button,-1);
  quick.append(button);
 }
 const hud=el('div',null,'journey-hud');
 const bubbleCue=el('p','Explore evidence bubbles · Hover to preview, select to open','journey-bubble-cue');
 hud.append(title,label,quick,heading,takeaway,chartReader,bubbleCue);
 const hubLinks=el('div',null,'journey-hub-links');
 hubLinks.append(visualButton,matrixButton);
 hub.append(contextButton,guide);
 if(report.sources[report.evidence_id]?.entry_key==='public-preview')hud.append(el('p','Partial source','meta'));
 const marks=el('div',null,'journey-marks');
 const preview=el('div',null,'journey-preview');
 preview.setAttribute('role','tooltip');preview.id='journey-preview';preview.hidden=true;
 const detail=el('aside',null,'journey-detail journey-sheet');
 detail.setAttribute('aria-label','Bubble details');detail.hidden=true;
 const closeDetail=el('button','Close','journey-sheet-close'), detailBody=el('div',null,'journey-reading');
 detailBody.tabIndex=0;
 detailBody.setAttribute('aria-label','Evidence and story details');
 const readerBar=el('div',null,'journey-reader-bar');
 const bubbleNav=el('nav',null,'journey-bubble-nav');
 bubbleNav.setAttribute('aria-label','Reading navigation');
 const previousBubble=el('button','← Previous'), bubbleCount=el('span',null,'meta'), nextBubble=el('button','Next bubble →');
 const aboveDepth=el('button','↑ Previous chapter'), belowDepth=el('button','Next chapter ↓');
 bubbleNav.append(previousBubble,bubbleCount,nextBubble,aboveDepth,belowDepth);
 const readerStart=el('button','↑ Start','journey-start');
 const readerMap=el('button','Big picture','journey-big-picture');
 const readerTools=el('div',null,'journey-reader-tools');
 readerTools.append(readerStart,readerMap);
 readerBar.append(bubbleNav,closeDetail,readerTools);
 detail.append(readerBar,detailBody);
 const footer=el('div',null,'journey-controls');
 const steps=el('nav',null,'journey-steps');
 steps.setAttribute('aria-label','Chapters');
 const reportButton=el('button','Report & notes','journey-report-button');
 const changesButton=el('button','What changed?','journey-changes-button');
 const askButton=el('button','Ask a question','primary journey-ask-button');
 const nextButton=el('button',null,'journey-next');
 const nextName=el('strong'), nextLabel=el('small','Up next ↓');
 nextButton.append(nextLabel,nextName);
 const previousButton=el('button',null,'journey-next journey-previous');
 const previousName=el('strong');
 previousButton.append(el('small','Back up ↑'),previousName);
 const directions=el('nav',null,'journey-directions');
 directions.setAttribute('aria-label','Adjacent chapters');
 directions.append(previousButton,nextButton);
 askButton.setAttribute('aria-expanded','false');
 const actions=el('div',null,'journey-footer-actions');
 const explore=el('div',null,'journey-explore'), tools=el('div',null,'journey-explore-tools');
 const exploreButton=el('button','Explore','journey-explore-toggle');
 exploreButton.type='button';
 exploreButton.setAttribute('aria-controls','journey-explore-tools');
 tools.id='journey-explore-tools';
 explore.append(exploreButton,tools);
 tools.append(steps,hubLinks,changesButton,reportButton);
 const startButton=el('button','↑ Start','journey-start');
 const mapButton=el('button','Big picture','journey-big-picture');
 actions.append(askButton,explore,startButton,mapButton);
 reportButton.setAttribute('aria-expanded','false');
 contextButton.setAttribute('aria-expanded','false');
 footer.append(directions,actions);
 stage.append(hud,marks,preview,footer,detail,notes,hub);track.append(stage);
 const branchRail=el('nav',null,'journey-branches');
 branchRail.setAttribute('aria-label','Separate questions in this argument');
 branchRail.hidden=true;
 const branchButtons=branches.map(branch=>{
  const button=el('button',branch.label,'journey-branch');
  button.setAttribute('aria-label',branch.label+' · '+layers[branch.target].title);
  button.onclick=()=>{pendingBubble=undefined;jumpToDepth(branch.target);};
  branchRail.append(button);
  return button;
 });
 stage.append(branchRail);
 const map=el('aside',null,'journey-sheet dive-map');
 map.setAttribute('aria-label','Big picture');map.hidden=true;
 const mapClose=el('button','Back to the dive','journey-sheet-close');
 const mapHead=el('div',null,'dive-map-heading'), mapBody=el('div',null,'dive-map-body');
 const mapStart=el('button','↑ Back to start','journey-start');
 const mapTitle=el('div',null,'dive-map-title');
 mapTitle.append(el('h3','Big picture'),el('p','Select a layer to preview its evidence.'));
 const mapActions=el('div',null,'dive-map-actions');
 mapActions.append(mapStart,mapClose);mapHead.append(mapTitle,mapActions);
 const paths=el('details',null,'dive-map-paths');
 mapBody.tabIndex=0;
 mapBody.setAttribute('aria-label','Story depth map');
 map.append(mapHead,mapBody);
 stage.append(map);
 let current=-1, frame, lastLevel=-1;
 let measuredHeader, measuredFooter;
 const layerButtons=[], layerGroups=[], pointPositions=new Map();
 let drag, stageBounds, previewAnchor, previewSize, detailAnchor, notesAnchor, askAnchor, selectedIndex=-1, pendingBubble, backToChapter, sceneTop, sceneBottom;
 let titleWords=[], lastTitlePhase, mapAnchor, readerItem;
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const addedSources={};
 function toggleExplore(open,restore=false){
  tools.hidden=!open;
  exploreButton.setAttribute('aria-expanded',String(open));
  if(restore)exploreButton.focus({preventScroll:true});
 }
 toggleExplore(false);
 exploreButton.onclick=()=>toggleExplore(tools.hidden);
 const questions=renderQuestions(report,updateFollowUps,()=>{
  dismissQuestions();
  stepButtons[followIndex].click();
  stepButtons[followIndex].focus({preventScroll:true});
 });
 stage.append(questions.sheet);
 function metrics(){
  const stickyTop=parseFloat(getComputedStyle(stage).top)||0;
  return {start:track.getBoundingClientRect().top-stickyTop,
   distance:Math.max(1,track.offsetHeight-stage.offsetHeight)};
 }
 function jumpToDepth(index){
   const {start,distance}=metrics();
   const fraction=routeLength>1?index/(routeLength-1):0;
   const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
   if(!detail.hidden)dismissDetail();
   window.scrollTo({top:window.scrollY+start+distance*fraction,behavior:still?'instant':'smooth'});
   if(still)setDepth(index);
 }
 function goToStart(){
  hidePreview();dismissMap();dismissQuestions();dismissNotes();dismissDetail();toggleExplore(false);
  pendingBubble=undefined;jumpToDepth(0);
  startButton.focus({preventScroll:true});
 }
 startButton.onclick=readerStart.onclick=mapStart.onclick=goToStart;
 function dismissMap(restore=false){
  if(map.hidden)return;
  map.hidden=true;
  stage.classList.remove('is-mapping');
  mapButton.setAttribute('aria-expanded','false');
  if(restore)(mapAnchor?.isConnected?mapAnchor:mapButton).focus({preventScroll:true});
  mapAnchor=undefined;
 }
 function showMap(trigger){
  hidePreview();toggleExplore(false);dismissQuestions();dismissNotes();
  mapAnchor=trigger;
  renderDiveMap(mapBody,layers.slice(0,routeLength),current,index=>{
   dismissMap();stepButtons[index].click();mapButton.focus({preventScroll:true});
  },(index,node)=>{
   dismissMap();
   if(index===current)inspect(layers[index].nodes[node],layerButtons[index][node],node);
   else{pendingBubble={layer:index,index:node};jumpToDepth(index);}
  },paths);
  map.hidden=false;mapBody.scrollTop=0;stage.classList.add('is-mapping');
  mapButton.setAttribute('aria-expanded','true');
  mapClose.focus({preventScroll:true});
 }
 mapButton.setAttribute('aria-expanded','false');
 mapButton.onclick=()=>showMap(mapButton);
 readerMap.onclick=()=>showMap(readerMap);
 mapClose.onclick=()=>dismissMap(true);
 const prompts=researchPrompts(report);
 if(prompts.length){
  paths.append(el('summary','Research a new angle'));
  for(const prompt of prompts){
   const button=el('button',prompt.title);
   button.onclick=()=>{
    dismissMap();revealQuestions(mapButton,report.dossier.title,prompt.question);
   };
   paths.append(button);
  }
 }else paths.hidden=true;
 const stepButtons=layers.map((layer,index)=>{
  const button=el('button',layer.guided?layer.title:layer.name);
  button.hidden=index>=routeLength;
  button.onclick=()=>{toggleExplore(false);pendingBubble=undefined;jumpToDepth(index);};
  steps.append(button);
  return button;
 });
 nextButton.onclick=()=>{if(current+1<routeLength)stepButtons[current+1].click();};
 previousButton.onclick=()=>stepButtons[current-1]?.click();
 function readDepth(index){
  if(index<0||index>=routeLength)return;
  pendingBubble={layer:index,index:-1};
  jumpToDepth(index);
 }
 aboveDepth.onclick=()=>readDepth(current-1);
 belowDepth.onclick=()=>readDepth(current+1);
 function navigateBubble(delta,trigger){
  const index=selectedIndex+delta, item=layers[current].nodes[index];
  const origin=backToChapter;
  if(item){
   inspect(item,layerButtons[current][index],index,trigger);
   if(origin){backToChapter=origin;closeDetail.textContent='Back to chapter';}
  }else if(index===-1)inspect(layers[current],contextButton,-1);
 }
 previousBubble.onclick=()=>navigateBubble(-1,previousBubble);
 nextBubble.onclick=()=>{
  if(selectedIndex+1<layers[current].nodes.length)navigateBubble(1,nextBubble);
  else readDepth(current+1);
 };
 function updateFollowUps(result){
  Object.assign(addedSources,result.sources);
  const nodes=[], seen=new Set();
  for(const item of result.questions){
   for(const finding of item.answer?.findings||[]){
    const key=finding.label.trim().toLowerCase()+'|'+[...finding.evidence_ids].sort().join(',');
    if(seen.has(key))continue;
    seen.add(key);
    nodes.push({label:finding.label,value:String(nodes.length+1),role:'Sourced finding',detail:finding.detail,
     context:'From your question · '+item.question,ids:finding.evidence_ids});
   }
  }
  const visible=nodes.slice(0,8);
  if(JSON.stringify(visible)===JSON.stringify(followUps.nodes.filter(node=>node.kind!=='evidence')))return;
  followUps.nodes=visible;
  withEvidence(followUps,addedSources);
  const oldLength=routeLength;
  routeLength=visible.length||current===followIndex?layers.length:followIndex;
  track.style.setProperty('--layers',routeLength);
  stepButtons[followIndex].hidden=routeLength===followIndex;
  followUps.takeaway=nodes.length?nodes.length+' sourced '+(nodes.length===1?'finding':'findings')+
   (nodes.length>visible.length?' · Latest '+visible.length+' shown':' from your follow-up questions.')
   :'Ask a question to explore another part of this story.';
  journeyScene?.replaceNodes(followIndex);
  buildButtons(followIndex);
  if(current===followIndex||routeLength!==oldLength&&current===followIndex-1&&detail.hidden)choose(current,true);
 }
 function dismissQuestions(restore=false){
  questions.sheet.hidden=true;askButton.setAttribute('aria-expanded','false');
  if(restore)(askAnchor?.isConnected&&!askAnchor.closest('[hidden]')?askAnchor:askButton).focus({preventScroll:true});
  askAnchor=undefined;
 }
 function revealQuestions(trigger,context='',question=''){
  hidePreview();toggleExplore(false);dismissDetail();dismissNotes();
  askAnchor=trigger;askButton.setAttribute('aria-expanded','true');
  questions.open(context,question);
 }
 askButton.onclick=()=>questions.sheet.hidden
  ?revealQuestions(askButton,layers[current].title):dismissQuestions(true);
 questions.close.onclick=()=>dismissQuestions(true);
 function hidePreview(){
  if(!previewAnchor)return;
  previewAnchor?.removeAttribute('aria-describedby');
  previewAnchor=undefined;preview.hidden=true;
  journeyScene?.hover(-1);
 }
 function positionPreview(){
  if(!previewAnchor||previewAnchor.hidden)return;
  const bounds=stageBounds||stage.getBoundingClientRect();
  const point=pointPositions.get(previewAnchor);
  const anchor=point?null:previewAnchor.getBoundingClientRect();
  const x=point?point.x:anchor.left-bounds.left+anchor.width/2;
  const top=(point?point.y-point.radius:anchor.top-bounds.top)-previewSize.height-12;
  const bottom=point?point.y+point.radius:anchor.bottom-bounds.top;
  const min=previewSize.width/2+8;
  preview.style.left=Math.max(min,Math.min(bounds.width-min,x))+'px';
  preview.style.top=Math.max(8,Math.min(bounds.height-previewSize.height-8,top>8?top:bottom+12))+'px';
 }
 function showPreview(point,button,layerIndex,index){
  if(!detail.hidden||!notes.hidden||!questions.sheet.hidden||!map.hidden||previewAnchor===button)return;
  hidePreview();previewAnchor=button;
  const role=(layerIndex>current?'Next chapter · ':'')+(point.role||layers[layerIndex].name);
  preview.replaceChildren(el('small',role),el('strong',point.label));
  const explanation=point.detail===point.label?point.context:point.detail||point.context;
  if(explanation)preview.append(el('span',explanation));
  if(point.ids?.length)preview.append(el('small',point.ids.length+' linked '+(point.ids.length===1?'record':'records'),'journey-preview-count'));
  button.setAttribute('aria-describedby',preview.id);
  preview.hidden=false;
  previewSize={width:preview.offsetWidth,height:preview.offsetHeight};
  if(layerIndex===current)journeyScene?.hover(index);
  positionPreview();
 }
 function dismissDetail(restore=false){
  detailBody.querySelector('.journey-map')?.dispatchEvent(new Event('atlas:dispose'));
  detail.hidden=true;
  bubbleNav.hidden=true;selectedIndex=-1;
  stage.classList.remove('is-inspecting','is-visual-open','is-reading','is-overview','is-chart-overview');
  journeyScene?.read?.(false);
  contextButton.setAttribute('aria-expanded','false');
  closeDetail.textContent='Close';
  backToChapter=undefined;
  readerItem=undefined;
  for(const button of layerButtons[current]||[])button.setAttribute('aria-pressed','false');
  journeyScene?.select(-1);
  frameScene();
  if(restore)detailAnchor?.focus({preventScroll:true});
  detailAnchor=undefined;
 }
 function dismissNotes(restore=false){
  notes.hidden=true;
  reportButton.setAttribute('aria-expanded','false');
  if(restore)(notesAnchor?.isConnected&&!notesAnchor.closest('[hidden]')?notesAnchor:reportButton).focus({preventScroll:true});
  notesAnchor=undefined;
 }
 function revealNotes(layer,trigger){
  hidePreview();dismissDetail();dismissQuestions();
  notesAnchor=trigger;
  reportButton.setAttribute('aria-expanded','true');
  openJourneyNotes(notes,layer?.chapter);
  if(layer?.name==='Claim checks')notes.querySelector('.story-argument')?.setAttribute('open','');
  if(layer?.name==='Sources')notes.querySelector('.journey-evidence').open=true;
  notes.querySelector('.journey-sheet-close').focus({preventScroll:true});
 }
 reportButton.onclick=()=>{toggleExplore(false);if(notes.hidden)revealNotes(null,exploreButton);else dismissNotes(true);};
 notes.querySelector('.journey-sheet-close').onclick=()=>dismissNotes(true);
 function closeReader(){
  const previous=backToChapter;
  if(previous?.index===current){
   inspect(previous.item,previous.anchor,previous.nodeIndex);
   detailBody.scrollTop=previous.scroll;
   backToChapter=previous.parent;
   if(backToChapter)closeDetail.textContent=backToChapter.item===layers[current]?'Back to chapter':'Back to bubble';
  }else dismissDetail(true);
 }
 closeDetail.onclick=closeReader;
 stage.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||event.defaultPrevented)return;
  pendingBubble=undefined;
  if(!map.hidden)dismissMap(true);
  else if(!tools.hidden)toggleExplore(false,true);
  else if(!questions.sheet.hidden)dismissQuestions(true);
  else if(!notes.hidden)dismissNotes(true);
  else if(!detail.hidden)closeReader();
  else hidePreview();
 });
 function inspect(item,button,index,navigation){
  hidePreview();toggleExplore(false);dismissNotes();dismissQuestions();dismissDetail();
  detailAnchor=button;
  selectedIndex=index;
  readerItem=item;
  const layer=layers[current], overview=item===layer, count=layer.nodes.length;
  bubbleNav.hidden=index<0&&!overview;
  bubbleCount.textContent=overview?'Chapter '+(current+1)+' of '+routeLength:index>=0?(index+1)+' of '+count:'';
  previousBubble.hidden=overview;
  previousBubble.textContent=index===0?'← Overview':'← Previous bubble';
  previousBubble.disabled=index<0;
  aboveDepth.hidden=current===0;
  belowDepth.hidden=current>=routeLength-1;
  const lastBubble=index>=count-1, nextDepth=current+1<routeLength?layers[current+1]:null;
  nextBubble.textContent=index<0&&overview?'Explore evidence →':'Next item →';
  nextBubble.disabled=lastBubble&&!nextDepth;
  nextBubble.hidden=lastBubble;
  contextButton.setAttribute('aria-expanded',String(button===contextButton));
  layerButtons[current].forEach((peer,i)=>peer.setAttribute('aria-pressed',String(i===index)));
  journeyScene?.select(index);
  stage.classList.toggle('is-inspecting',Boolean(journeyScene&&index>=0));
  stage.classList.add('is-reading');
  stage.classList.toggle('is-overview',overview);
  stage.classList.toggle('is-chart-overview',overview&&Boolean(layer.visual));
  journeyScene?.read?.(true);
  const header=el('header',null,'journey-reading-header'), heading=el('div');
  const avatar=el('span',null,'journey-person-avatar');avatar.hidden=true;
  heading.append(el('p',item.role||layers[current].name,'kicker'),el('h4',item.label||item.title));
  const reading=overview?el('article',null,'journey-chapter-copy'):detailBody;
  if(overview)detailBody.replaceChildren(reading,depthGuide(layer));
  header.append(avatar,heading);reading.replaceChildren(header);
  const explanation=item.detail||item.takeaway;
  if(explanation&&explanation!==item.label)reading.append(el('p',explanation,'journey-reading-lede'));
  if(item.context&&item.context!==(item.detail||item.takeaway)){
   if(overview&&item.guided)reading.append(el('h5','Why this matters'));
   reading.append(el('p',item.context,'journey-reading-context'));
  }
  if(overview&&item.concepts?.length){
   const concepts=el('dl',null,'journey-concepts');
   for(const concept of item.concepts)concepts.append(el('dt',concept.label),el('dd',concept.explanation));
   reading.append(concepts);
  }
  if(overview&&item.name==='Takeaway'){
   const recap=el('dl',null,'journey-concepts');
   for(const claim of leadClaims(report).slice(0,2)){
    recap.append(el('dt',claim.verdict==='unresolved'?'Still open':claimStatus(claim)),el('dd',claim.reason));
   }
   if(recap.childElementCount)reading.append(recap);
  }
  const person=item.person;
  if(person){
   const context=el('div',null,'journey-person-context');
   const profile=link(person.profile_url);profile.textContent='Public profile ↗';
   header.append(profile);
   const posts=report.dossier.posts.filter(post=>post.author===person.handle);
   const claims=report.dossier.claims.filter(claim=>claim.speaker===person.handle);
   if(person.public_context)context.append(el('h5','Public background'),el('p',person.public_context.summary));
   if(person.role_in_story)context.append(el('h5','Why this person matters here'),el('p',person.role_in_story.summary));
   else if(posts.length&&posts[0].relationship!==item.context){
    context.append(el('h5','Role in the exchange'),el('p',posts[0].relationship));
   }
   if(claims.length){
    const list=el('ul',null,'journey-person-claims');
    for(const claim of claims){
     const entry=el('li');entry.append(el('span',claimStatus(claim),'meta'),el('p',claim.claim));list.append(entry);
    }
    context.append(el('h5','Claims checked in this story'),list);
   }
   if(context.childElementCount)reading.append(context);
  }
  if(item.visual)reading.append(renderDiveVisual(report,item.visual));
  if(item.comparison)comparisonTable(reading,item.comparison,report.sources);
  if(item.measurement||item.visual){
   const chart=item.visual||layer.visual;
   if(chart){
    const delta=surveyDifference(chart,item.measurement);
    if(delta)reading.append(delta);
   }
  }
  const ids=[...item.ids,...(person?.role_in_story?.evidence_ids||[]),...(person?.public_context?.evidence_ids||[])];
  const records=[...new Set(ids)].map(id=>({id,source:report.sources[id]||addedSources[id]})).filter(record=>record.source);
  if(item.post||overview&&layer.name==='Story'){
   const trail=renderQuoteTrail(report,item.post,post=>{
    const at=layer.nodes.findIndex(node=>node.post===post);
    const candidate=at>=0?layer.nodes[at]:cloudLayers(report).find(candidate=>candidate.name==='Story')?.nodes.find(node=>node.post===post);
    if(candidate)openChapterBranch(candidate,at>=0?layerButtons[current][at]:contextButton,at);
   });
   if(trail)reading.append(trail);
  }
  if(item.kind==='evidence'||item.kind==='document'&&!item.post){
   const connections=renderClaimConnections(report,ids,claim=>openChapterBranch(claimBubble(claim),contextButton,-1));
   if(connections)reading.append(connections);
  }
  if(item.claim){
   renderClaimLens(reading,item.claim,report,(claim,source,finished)=>researchStoryUpdate(report,claim,source,finished));
  }else if(records.length){
   if(['Story','Perspectives','Sources'].includes(layers[current].name)&&item.kind!=='evidence'){
    if(overview&&item.guided)fold(reading,'Read the captured original',panel=>panel.append(sourceCapturePanel(records[0].source)));
    else reading.append(sourceCapturePanel(records[0].source,person?avatar:undefined));
   }
   const evidence=el('div',null,'journey-citations');
   evidence.append(el('h5',records.length===1?'Source record':records.length+' linked sources'));
   for(const [recordIndex,{id,source}] of records.entries()){
    const citation=el('button',source.title||'Inspect source');
    citation.onclick=()=>run(()=>openEvidence(id,citation));
    const entry=el('article');
    entry.append(citation);
    const meta=[evidenceOrigin(source),source.date_raw||source.date_utc?.slice(0,10)].filter(Boolean).join(' · ');
    if(meta)entry.append(el('p',meta,'meta'));
    if(source.excerpt&&source.excerpt!==item.detail){
     const excerpt=el('p',source.excerpt,'journey-excerpt');
     if(recordIndex===0)entry.append(excerpt);
     else fold(entry,'Read captured excerpt',panel=>panel.append(excerpt));
    }
    evidence.append(entry);
   }
   if(overview&&item.guided)fold(reading,'Sources used in this chapter',panel=>panel.append(evidence));
   else reading.append(evidence);
  }
  const deeper=el('button',item.kind==='evidence'?'Browse every source':layer.action);
  deeper.onclick=()=>layer===followUps?revealQuestions(button):revealNotes(item.kind==='evidence'?{name:'Sources'}:layer,button);
  const ask=el('button','Ask about this');
  ask.onclick=()=>revealQuestions(button,[layer.title,item.label,item.detail].filter(Boolean).join(' · '),
   layer.name==='What’s open'?'What evidence would resolve this gap?':'');
  const actions=el('div',null,'journey-sheet-actions');
  actions.append(deeper,ask);reading.append(actions);
  detail.hidden=false;detailBody.scrollTop=0;
  frameScene();animateReading(detailBody);
  (navigation&&!navigation.disabled?navigation:closeDetail).focus({preventScroll:true});
 }
 function depthGuide(layer){
  const guide=el('section',null,'journey-depth-guide');
  guide.setAttribute('aria-label','Explore this chapter');
  const options=el('div',null,'journey-guide-options');
  const sources=new Set([...layer.ids,...layer.nodes.flatMap(node=>node.ids)]);
  const summary=el('p',[
   layer.nodes.length?'Explore related evidence':'',
   sources.size?sources.size+' linked '+(sources.size===1?'record':'records'):'',
  ].filter(Boolean).join(' · '),'meta');
  if(summary.textContent)guide.append(summary);
  for(const [index,node] of layer.nodes.slice(0,layer.guided?3:4).entries()){
   const button=el('button');
   const label=(layer.name==='Comparison'||layer.name==='Takeaway')&&node.claim?.verdict==='unresolved'
    ?'Check the unresolved claim':node.label;
   button.append(el('small',node.role,'meta'),el('strong',label));
   const caption=bubblePreview(node);
   if(caption&&caption!==label)button.append(el('span',caption,'journey-guide-caption'));
   button.onclick=()=>openChapterBranch(node,layerButtons[current][index],index);
   options.append(button);
  }
  if(layer.name==='Story'){
   for(const claim of leadClaims(report).slice(0,2)){
    const button=el('button');
    button.append(el('small',claimStatus(claim),'meta'),el('strong',claim.claim));
    button.onclick=()=>openChapterBranch(claimBubble(claim),contextButton,-1);
    options.append(button);
   }
  }
  if(options.childElementCount)guide.append(options);
  return guide;
 }
 function openChapterBranch(item,button,index){
  const origin={index:current,item:readerItem,anchor:detailAnchor,nodeIndex:selectedIndex,
   parent:backToChapter,scroll:detailBody.scrollTop};
  inspect(item,button,index);
  backToChapter=origin;
  closeDetail.textContent=origin.item===layers[current]?'Back to chapter':'Back to bubble';
 }
 function animateReading(element,shift=9){
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
   const frames=shift?[{opacity:.35,transform:'translateY('+shift+'px)'},{opacity:1,transform:'translateY(0)'}]
    :[{opacity:.55},{opacity:1}];
   element.animate?.(frames,{duration:340,easing:'cubic-bezier(.2,.75,.25,1)'});
  }
 }
 contextButton.onclick=()=>inspect(layers[current],contextButton,-1);
 chartReader.onclick=()=>inspect(layers[current],chartReader,-1);
 for(const button of [contextButton,chartReader]){
  const previewChapter=()=>{
   const layer=layers[current];
   if(layer)showPreview({...layer,label:button===chartReader?layer.visual?.title:layer.title,
    role:button===chartReader?'Interactive chart':'Layer overview'},button,current,-1);
  };
  button.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')previewChapter();});
  button.addEventListener('pointerleave',()=>{if(previewAnchor===button&&document.activeElement!==button)hidePreview();});
  button.addEventListener('focus',previewChapter);
  button.addEventListener('blur',()=>{if(previewAnchor===button)hidePreview();});
 }
 function showVisual(trigger,render){
  hidePreview();dismissNotes();dismissQuestions();dismissDetail();
  toggleExplore(false);
  detailAnchor=trigger.closest('.journey-explore-tools')?exploreButton:trigger;
  detailBody.replaceChildren();
  render(detailBody);
  stage.classList.add('is-visual-open','is-reading');
  journeyScene?.read?.(true);
  detail.hidden=false;detailBody.scrollTop=0;
  frameScene();
  closeDetail.focus({preventScroll:true});
 }
 visualButton.onclick=()=>showVisual(visualButton,panel=>{
  const layer=layers[current];
  if(layer.name==='Story'){
   panel.append(renderExchangeVisual(report,index=>{
    const post=report.dossier.posts[index];
    inspect({label:post.author,detail:post.summary,context:post.relationship,ids:post.evidence_ids,
     person:report.dossier.participants.find(person=>person.handle===post.author)},visualButton,-1);
   }));
  }
  else if(layer.visual)panel.append(renderDiveVisual(report));
  else if(layer.comparison)comparisonTable(panel,layer.comparison,report.sources);
  else{
   const map=el('div',null,'journey-map');
   panel.append(map);
   renderArgumentMap(map,report);
  }
 });
 matrixButton.onclick=()=>showVisual(matrixButton,panel=>{
  panel.append(renderEvidenceMatrix(report,claim=>inspect(claimBubble(claim),matrixButton,-1)));
 });
 changesButton.onclick=()=>showVisual(changesButton,panel=>{
  panel.append(renderStoryChanges(report,()=>researchStoryUpdate(report)));
 });
 contextButton.addEventListener('pointermove',event=>{
  if(event.pointerType==='touch'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const box=contextButton.getBoundingClientRect();
  contextButton.style.setProperty('--hub-tilt-x',((.5-(event.clientY-box.top)/box.height)*10)+'deg');
  contextButton.style.setProperty('--hub-tilt-y',(((event.clientX-box.left)/box.width-.5)*12)+'deg');
 });
 contextButton.addEventListener('pointerleave',()=>{
  contextButton.style.removeProperty('--hub-tilt-x');
  contextButton.style.removeProperty('--hub-tilt-y');
 });
 function choose(index,force=false){
  if(index===current&&!force)return;
  hidePreview();dismissDetail();
  current=index;
  const layer=layers[index];
  label.textContent='Chapter '+(index+1)+' / '+routeLength;
  heading.textContent=layer.title;
  titleWords=[];
  const kineticTitle=index===0||Boolean(layer.visual);
  lastTitlePhase=undefined;
  if(kineticTitle&&layer.title.length<=100&&journeyScene&&!reduce.matches){
   heading.setAttribute('aria-label',layer.title);
   titleWords=layer.title.split(/\s+/).map(word=>{
    const part=el('span',word,'journey-title-word');
    part.setAttribute('aria-hidden','true');
    return part;
   });
   heading.replaceChildren(...titleWords.flatMap((word,i)=>i?[document.createTextNode(' '),word]:[word]));
  }else heading.removeAttribute('aria-label');
  const answer=layer.takeaway||'';
  takeaway.textContent=answer.length<=240?answer:answer.match(/^.{20,220}?[.!?](?=\s|$)/s)?.[0]||'';
  guide.textContent=layer.guide||'';
  guide.hidden=!layer.guide;
  hubAction.textContent=layer===followUps?'View findings':layer.name==='Story'?'What started this?':
   layer.name==='Perspectives'?'Compare viewpoints':layer.name==='Comparison'?'Compare the hardware':
   layer.name==='Sources'?'Trace the evidence':layer.name==='What’s open'?'See what’s missing':'Explore this layer';
  const posts=layer.nodes.filter(node=>node.post).length;
  hubMeta.textContent=posts?posts+' captured '+(posts===1?'post':'posts'):
   layer.nodes.length+' '+(layer.nodes.length===1?'bubble':'bubbles');
  contextButton.setAttribute('aria-label','Open '+layer.title);
  const next=index+1<routeLength?layers[index+1]:null;
  const previous=layers[index-1];
  previousButton.hidden=!previous;
  previousName.textContent=previous?.title||'';
  nextButton.hidden=!next;
  nextLabel.textContent=next?.detour&&!layer.detour?'Dive deeper ↓':'Up next ↓';
  nextName.textContent=next?.title||'';
  stage.classList.toggle('is-measuring',Boolean(layer.visual));
  chartReader.hidden=!layer.visual;
  bubbleCue.hidden=!layer.nodes.length;
  bubbleCue.textContent=layer.visual?'Explore the chart bubble or select a column':
   'Explore evidence bubbles · Hover to preview, select to open';
  if(layer.visual&&chartReader.dataset.chart!==layer.visual.title){
   chartReader.dataset.chart=layer.visual.title;
   chartReader.replaceChildren(bubbleGraphic(layer.visual),el('span','Open chart'));
   chartReader.setAttribute('aria-label','Open chart · '+layer.visual.title);
  }
  const visualTitle=layer.visualTitle||(layer.comparison?'Compare hardware':layer.name==='Claim checks'?'Open argument map':
   layer.name==='Story'&&report.dossier.posts.length?'Timeline':'');
  visualButton.textContent=visualTitle;visualButton.hidden=!visualTitle;
  matrixButton.hidden=!report.dossier.claims.length||!['Story','Claim checks','Sources'].includes(layer.name);
  quick.hidden=index!==0||!quick.childElementCount;
  stepButtons.forEach((button,i)=>button.setAttribute('aria-current',i===index?'step':'false'));
  layerGroups.forEach((group,i)=>{group.style.zIndex=i===index?'1':'0';});
  if(!journeyScene)layerGroups.forEach((group,i)=>{group.hidden=i!==index;});
  if(!titleWords.length)animateReading(heading,0);
 }
 function buildButtons(layerIndex){
  const layer=layers[layerIndex];
  const group=layerGroups[layerIndex]||el('div',null,'journey-layer');
  if(!layerGroups[layerIndex])marks.append(group);
  layerGroups[layerIndex]=group;
  layerButtons[layerIndex]=layer.nodes.map((point,pointIndex)=>{
   const button=el('button',null,'journey-point');
   if(point.kind==='evidence')button.classList.add('journey-evidence-orb');
   button.hidden=Boolean(journeyScene);
   button.tabIndex=journeyScene?-1:0;
   button.setAttribute('aria-pressed','false');
   button.setAttribute('aria-label',[point.label,point.role,point.value].filter(Boolean).join(' · '));
   button.append(el('strong',point.value),el('span',point.label,'journey-point-label'),el('small',point.role));
   const caption=bubblePreview(point);
   if(caption&&caption!==point.label){
    const summary=el('span',caption,'journey-point-caption');
    summary.setAttribute('aria-hidden','true');button.append(summary);
   }
   button.onclick=()=>{
    if(layerIndex!==current){
     pendingBubble={layer:layerIndex,index:pointIndex};
     jumpToDepth(layerIndex);
    }else if(button.getAttribute('aria-pressed')==='true')dismissDetail(true);
    else inspect(point,button,pointIndex);
   };
   button.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')showPreview(point,button,layerIndex,pointIndex);});
   button.addEventListener('pointerleave',()=>{if(previewAnchor===button&&document.activeElement!==button)hidePreview();});
   button.addEventListener('focus',()=>showPreview(point,button,layerIndex,pointIndex));
   button.addEventListener('blur',()=>{if(previewAnchor===button)hidePreview();});
   return button;
  });
  group.replaceChildren(...layerButtons[layerIndex]);
  group.hidden=!journeyScene&&layerIndex!==current;
 }
 function project(points,motion){
  if(!stageBounds||!stage.isConnected)return;
  if(titleWords.length&&Number.isFinite(motion?.depth)){
   const phase=Math.min(1,Math.abs(motion.depth-current)*2.15);
   if(lastTitlePhase===undefined||Math.abs(phase-lastTitlePhase)>.008||phase===0&&lastTitlePhase!==0){
    lastTitlePhase=phase;
    for(const [index,word] of titleWords.entries()){
     const delta=index-(titleWords.length-1)/2;
     const space=phase*(.55+Math.abs(delta)/Math.max(1,titleWords.length));
     word.style.setProperty('--word-lift',space*(8+delta*.8)+'px');
     word.style.setProperty('--word-z',-space*(55+Math.abs(delta)*12)+'px');
     word.style.setProperty('--word-yaw',delta*space*2.7+'deg');
    }
   }
  }
  const lanes=motion?.branches||[];
  const branching=!detail.hidden?false:lanes.some(lane=>lane.opacity>.12);
  branchRail.hidden=!branching;
  if(branching){
   for(const [index,button] of branchButtons.entries()){
    const lane=lanes[index];
    button.hidden=!lane||lane.opacity<=.12;
    if(button.hidden)continue;
    button.tabIndex=lane.opacity>=.7?0:-1;
    button.style.setProperty('--branch-x',(lane.x-stageBounds.left)+'px');
    button.style.setProperty('--branch-y',(lane.y-stageBounds.top)+'px');
    button.style.setProperty('--branch-opacity',lane.opacity);
    button.style.setProperty('--branch-scale',lane.scale);
   }
  }
  if(motion?.core){
   const {x,y,scale}=motion.core;
   stage.classList.add('has-rendered-core');
   hub.style.left=(x-stageBounds.left)+'px';
   hub.style.top=(y-stageBounds.top)+'px';
   hub.style.setProperty('--hub-render-scale',scale);
  }else{
   stage.classList.remove('has-rendered-core');
   hub.style.left='50%';
   hub.style.setProperty('--hub-render-scale',1);
  }
  pointPositions.clear();
  for(const point of points){
   const button=layerButtons[point.layer]?.[point.index];
   if(!button)continue;
   const x=point.x-stageBounds.left,y=point.y-stageBounds.top;
   if(x<20||x>stageBounds.width-20||y<30||y>stageBounds.height-40)continue;
   const labelBottom=point.base??(point.y+Math.max(44,point.radius+52));
   if(!detail.hidden||labelBottom>sceneBottom||point.y-point.radius<sceneTop)continue;
   pointPositions.set(button,{x,y,radius:point.radius});
   button.style.transform='translate('+x+'px,'+y+'px) translate(-50%,-.55em)';
   button.style.setProperty('--point-size',Math.max(30,point.radius*2)+'px');
   button.style.setProperty('--point-presence',point.presence);
   button.classList.toggle('is-chart-point',point.chart===true);
   button.classList.toggle('is-chart-reference',point.reference===true);
   button.style.setProperty('--chart-offset',(point.base===undefined?0:point.base-point.y)+'px');
   button.style.setProperty('--chart-hit-height',(point.barHeight||0)+'px');
   button.classList.toggle('is-nearby',point.layer!==current);
   button.tabIndex=point.layer===current?0:-1;
  }
  for(const buttons of layerButtons){
   for(const button of buttons)button.hidden=!pointPositions.has(button);
  }
  if(previewAnchor?.hidden)hidePreview();else positionPreview();
  if(Number.isFinite(motion?.depth)&&motion.arrival<.66)openPending(motion.depth);
 }
 function setDepth(level){
  const index=Math.round(level);
  choose(index);
  journeyScene?.move(level,index);
  frameScene();
  if(!journeyScene||matchMedia('(prefers-reduced-motion: reduce)').matches)openPending(level);
 }
 function openPending(level){
  if(pendingBubble?.layer!==current||Math.abs(level-current)>=.075)return;
  const {index}=pendingBubble;
  pendingBubble=undefined;
  const item=index===-1?layers[current]:layers[current].nodes[index];
  if(item)inspect(item,index===-1?contextButton:layerButtons[current][index],index);
 }
 function frameScene(){
  const panel=!detail.hidden?detail.getBoundingClientRect():null;
  const top=hud.getBoundingClientRect().bottom+8;
  const footerBox=footer.getBoundingClientRect();
  const bottom=Math.min(window.innerHeight,footerBox.top);
  const bounds=stage.getBoundingClientRect();
  const footerHeight=Math.ceil(footerBox.height);
  if(footerHeight!==measuredFooter){
   measuredFooter=footerHeight;
   track.style.setProperty('--journey-footer-height',footerHeight+'px');
  }
  const safe=Number.isFinite(bottom)&&bottom>top+80;
  sceneTop=safe?top:-Infinity;
  sceneBottom=safe?bottom:Infinity;
  let dock;
  if(panel){
   const side=bounds.width>=850;
   const space=side?panel.left-bounds.left:panel.top-bounds.top;
   const diameter=side?Math.min(space-28,bounds.height*.48):Math.min(88,space-14);
   dock={x:bounds.left+(side?space/2:bounds.width/2),
    y:bounds.top+(side?bounds.height*.43:space/2),radius:Math.max(22,diameter/2)};
   if(selectedIndex>=0){
    dock.subject={x:bounds.left+(side?space/2:bounds.width*.64),
     y:bounds.top+(side?bounds.height*.60:space/2)};
    dock.x=side?dock.x:bounds.left+bounds.width*.33;
    dock.y=side?bounds.top+bounds.height*.24:dock.y;
    dock.radius=Math.min(dock.radius,side?65:32);
   }
  }
  if(!journeyScene){
   hub.style.left=dock?(dock.x-bounds.left)+'px':'50%';
   hub.style.top=(dock?dock.y:(top+bottom)/2)-bounds.top+'px';
   hub.style.setProperty('--hub-render-scale',dock?dock.radius/(contextButton.offsetWidth/2):1);
  }
  journeyScene?.frame(top,bottom,null,contextButton.offsetWidth/2,dock,{left:bounds.left,width:bounds.width});
 }
 function update(){
  frame=undefined;
  if(!track.isConnected)return;
  stageBounds=stage.getBoundingClientRect();
  if(previewAnchor)previewSize={width:preview.offsetWidth,height:preview.offsetHeight};
  const {start,distance}=metrics();
  const level=Math.max(0,Math.min(1,-start/distance))*(routeLength-1);
  if(level!==lastLevel){lastLevel=level;setDepth(level);}
  else frameScene();
 }
 function schedule(){if(frame===undefined)frame=requestAnimationFrame(update);}
 function syncLayout(){
  const height=Math.ceil(appHeader?.getBoundingClientRect().height||0);
  if(height&&height!==measuredHeader){
   measuredHeader=height;
   track.style.setProperty('--journey-top',(height+3)+'px');
  }
  schedule();
 }
 stage.addEventListener('wheel',()=>{pendingBubble=undefined;},{passive:true});
 stage.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.target.closest('button,a,summary,.journey-sheet,.journey-hud,.journey-controls'))return;
  toggleExplore(false);
  hidePreview();
  drag={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
  stage.setPointerCapture(event.pointerId);
 });
 stage.addEventListener('pointermove',event=>{
  if(drag?.id!==event.pointerId)return;
  const dx=event.clientX-drag.x, dy=event.clientY-drag.y;
  if(!drag.moved&&Math.hypot(dx,dy)<6)return;
  drag.moved=true;
  if(journeyScene){
   stage.classList.add('is-rotating');
   journeyScene.rotate(dx*.008,dy*.005);
  }
  drag.x=event.clientX;drag.y=event.clientY;
 });
 stage.addEventListener('pointerup',event=>{
  if(drag?.id!==event.pointerId)return;
  if(!drag.moved&&!detail.hidden)dismissDetail(true);
 });
 stage.addEventListener('lostpointercapture',()=>{
  drag=undefined;
  stage.classList.remove('is-rotating');
 });
 window.addEventListener('scroll',schedule,{passive:true});
 window.addEventListener('resize',syncLayout);
 const layoutObserver=typeof ResizeObserver==='function'?new ResizeObserver(syncLayout):null;
 for(const element of [appHeader,stage,hud,footer])if(element)layoutObserver?.observe(element);
 track.addEventListener('atlas:dispose',()=>{
  window.removeEventListener('scroll',schedule);
  window.removeEventListener('resize',syncLayout);
  layoutObserver?.disconnect();
  if(frame!==undefined)cancelAnimationFrame(frame);
  dismissDetail();
  questions.dispose();
  journeyScene?.clear();
 },{once:true});
 if(!journeyScene)stage.classList.add('journey-fallback');
 layers.forEach((_,index)=>buildButtons(index));
 choose(0);
 journeyScene?.show(layers,project,branches);
 questions.refresh();
 syncLayout();
 return track;
}
