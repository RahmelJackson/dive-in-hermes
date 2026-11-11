const proofRoles={
 statement:'Original claim',
 supports:'Supports',
 challenges:'Challenges',
 context:'Context',
 unclassified:'Linked source',
};

function claimStatus(claim){
 return claim.attribution==='inferred'?'Inferred comparison':claim.verdict;
}

function claimSourceGroups(claim,sources){
 const groups=new Map();
 for(const id of new Set(claim.evidence_ids)){
  const record=sources[id];
  if(!record)continue;
  const links=claim.evidence?.filter(item=>item.evidence_id===id)||[];
  const annotations=links.length?links:[{role:'unclassified',note:''}];
  for(const item of annotations){
   const origin=sources[item.origin_evidence_id]||record;
   const key=origin.article_url;
   const group=groups.get(key)||{url:key,title:origin.title||key,entries:[]};
   group.entries.push({id,record,role:item.role,note:item.note});
   groups.set(key,group);
  }
 }
 return [...groups.values()];
}

function leadClaims(report){
 const claims=report.dossier.claims;
 const author=report.dossier.posts.find(post=>post.evidence_ids.includes(report.evidence_id))?.author;
 const open=claims.find(claim=>claim.verdict==='unresolved'&&claim.speaker===author)||
  claims.find(claim=>claim.verdict==='unresolved');
 const checked=claims.find(claim=>claim.verdict!=='unresolved');
 return [...new Set([checked,open,...claims].filter(Boolean))].slice(0,3);
}

function matchedClaimMeasurement(claim,charts){
 for(const chart of charts){
  const reference=chart.reference;
  if(!reference||!chart.evidence_ids.every(id=>claim.evidence_ids.includes(id)))continue;
  const name=claim.claim.toLowerCase(), label=reference.label.toLowerCase();
  const measured=chart.values.find(mark=>mark.label&&name.includes(mark.label.toLowerCase())&&label.includes(mark.label.toLowerCase()));
  if(measured)return {chart,reference,measured};
 }
}

function measurementLabel(mark,unit){
 return String(mark.value)+(unit==='%'?'%':unit?' '+unit:'');
}

function surveyDifference(chart,selected){
 const reference=chart.reference;
 if(!reference)return null;
 const label=reference.label.toLowerCase();
 const measured=chart.values.find(mark=>mark.label&&label.includes(mark.label.toLowerCase()));
 if(!measured||selected&&selected!==reference&&selected!==measured)return null;
 const diff=measured.value-reference.value;
 const gap=Number(Math.abs(diff).toPrecision(4));
 const unit=chart.unit==='%'?'percentage points':chart.unit;
 const caption=diff===0?'The measured and reference values match.':
  gap+' '+unit+' '+(diff<0?'below':'above')+' the reference figure.';
 const note=el('div',null,'measurement-insight');
 const left=el('div'),right=el('div');
 left.append(el('small','Reference figure'),el('strong',measurementLabel(reference,chart.unit)));
 right.append(el('small','Measured · '+measured.label),el('strong',measurementLabel(measured,chart.unit)));
 note.append(left,right,el('p',caption));
 if(!selected&&chart.unit==='%'&&measured.value>0){
  const comparison=chart.values.reduce((best,mark)=>mark.value>best.value?mark:best,measured);
  if(comparison!==measured){
   const ratio=Number((comparison.value/measured.value).toPrecision(2));
   note.append(el('p',comparison.label+' had '+ratio+'× the '+measured.label+' survey share ('+
    measurementLabel(comparison,chart.unit)+' vs. '+measurementLabel(measured,chart.unit)+').','meta'));
  }
 }
 return note;
}

function claimComparison(claim,charts){
 const match=matchedClaimMeasurement(claim,charts);
 if(!match)return;
 const {chart,reference,measured}=match;
 const figure=el('figure',null,'claim-comparison');
 figure.append(el('figcaption',chart.title),el('p',chart.period,'meta'));
 const max=Math.max(reference.value,measured.value)||1;
 for(const [label,mark] of [['Reference figure',reference],['Measured value',measured]]){
  const row=el('div',null,'claim-comparison-row'), fill=el('i');
  fill.style.width=(100*mark.value/max)+'%';fill.setAttribute('aria-hidden','true');
  row.append(fill,el('span',label),el('strong',measurementLabel(mark,chart.unit)));figure.append(row);
 }
 if(chart.caveat)figure.append(el('p',chart.caveat,'meta'));
 const contrast=surveyDifference(chart,measured);
 if(contrast)figure.append(contrast);
 return figure;
}

function renderClaimLens(parent,claim,report,checkSource){
 const groups=claimSourceGroups(claim,report.sources);
 const section=el('section',null,'claim-lens');
 if(claim.attribution==='inferred'){
  section.append(el('p','This is a comparison the investigation inferred from the exchange. Assessment · '+claim.verdict+'.','meta'));
 }
 const comparison=claimComparison(claim,report.dossier.charts);
 if(comparison)section.append(comparison);
 section.append(el('h5','Evidence for this claim'));
 if(!groups.length)section.append(el('p','This claim has no captured sources yet.','meta'));
 const roles=[...new Set(groups.flatMap(group=>group.entries.map(entry=>entry.role)))];
 for(const role of roles){
  const block=el('div',null,'claim-proof-group');
  block.dataset.role=role;
  block.append(el('h6',proofRoles[role]));
  for(const group of groups){
   const entries=group.entries.filter(entry=>entry.role===role);
   if(!entries.length)continue;
   const item=el('article');
   const origin=link(group.url);origin.textContent=group.title+' ↗';item.append(origin);
   for(const entry of entries){
    if(entry.note)item.append(el('p',entry.note));
   }
   const records=[...new Map(entries.map(entry=>[entry.id,entry])).values()];
   for(const entry of records){
    const button=el('button',entry.record.article_url===group.url?'View captured evidence':'View derivative capture');
    button.onclick=()=>run(()=>openEvidence(entry.id,button));
    item.append(button);
   }
   block.append(item);
  }
  section.append(block);
 }
 if(groups.length){
  const captures=new Set(groups.flatMap(group=>group.entries.map(entry=>entry.id))).size;
  section.append(el('p',captures+' '+(captures===1?'capture':'captures')+' grouped under '+groups.length+' '+(groups.length===1?'source URL':'source URLs')+'.','meta'));
 }
 const share=el('button','Copy claim brief'), feedback=el('p',null,'meta');
 const shareText=el('textarea');
 shareText.hidden=true;shareText.readOnly=true;shareText.rows=8;
 shareText.setAttribute('aria-label','Shareable claim brief');feedback.setAttribute('role','status');
 share.onclick=async()=>{
  shareText.value=[
   '# '+claim.claim,'', 'Story: '+report.dossier.title,
   'Checked revision: '+(report.revision_at||report.saved_at)+(report.revision_id?' · #'+report.revision_id:''),
   claim.attribution==='inferred'?'Framing: inferred from the exchange':'Attributed to: '+claim.speaker,
   'Assessment: '+claim.verdict,'',claim.reason,'',
   ...groups.flatMap(group=>['- '+group.title+' — '+group.url,
    ...group.entries.filter(entry=>entry.note).map(entry=>'  - '+proofRoles[entry.role]+' — '+entry.note)]),
  ].join('\n');
  try{
   await navigator.clipboard.writeText(shareText.value);
   feedback.textContent='Claim brief copied with its sources.';
  }catch{
   shareText.hidden=false;shareText.focus();shareText.select();
   feedback.textContent='Select and copy this claim brief.';
  }
 };
 section.append(share,feedback,shareText);
 const add=el('details',null,'claim-add-source');
 const form=el('form'), input=el('input'), label=el('label','Public link to check');
 input.type='url';input.required=true;input.maxLength=2048;label.append(input);
 const submit=el('button','Check this source'), result=el('p',null,'meta');
 result.setAttribute('role','status');
 form.append(label,submit,result);add.append(el('summary','Check another source'),form);section.append(add);
 form.onsubmit=async event=>{
  event.preventDefault();
  if(submit.disabled)return;
  submit.disabled=true;
  result.textContent='Sending the source to Codex…';
  try{
   const url=new URL(input.value.trim());
   if(!['https:','http:'].includes(url.protocol))throw Error('Enter a public HTTP or HTTPS link.');
   await checkSource(claim,url.href,error=>{
    if(error){result.textContent=error;submit.disabled=false;}
   });
   result.textContent='Source check started. Open What changed? once it’s saved.';
  }catch(error){
   result.textContent=error.message;submit.disabled=false;
  }
 };
 parent.append(section);
}

function renderExchangeVisual(report,openPost){
 const section=el('section',null,'lens-exchange');
 const items=report.dossier.posts.map((post,index)=>{
  const captured=post.evidence_ids.map(id=>report.sources[id]).filter(Boolean);
  const direct=captured.find(source=>source.id===report.evidence_id)||
   (captured.length===1?captured[0]:undefined);
  const time=direct?.date_utc?Date.parse(direct.date_utc):NaN;
  return {post,index,direct,time};
 });
 const dated=items.filter(item=>Number.isFinite(item.time)).sort((a,b)=>a.time-b.time);
 const undated=items.filter(item=>!Number.isFinite(item.time));
 section.append(el('h4','How the exchange unfolded'),
  el('p','Dates come from the linked source records. Items without verified timestamps are shown separately.','meta'));
 if(!items.length)section.append(el('p','No individual posts have been captured.'));
 for(const [title,entries] of [['Dated posts',dated],['Captured posts without a verified time',undated]]){
  if(!entries.length)continue;
  section.append(el('h5',title));
  const list=el('ol');
  for(const {post,index,direct,time} of entries){
   const item=el('li'), button=el('button',post.author);
   button.onclick=()=>openPost(index,button);
   item.append(el('span',Number.isFinite(time)?direct.date_raw||direct.date_utc:post.relationship,'meta'),button,el('p',post.summary));
   if(Number.isFinite(time)&&post.relationship)item.append(el('p',post.relationship,'meta'));
   list.append(item);
  }
  section.append(list);
 }
 return section;
}

function renderEvidenceMatrix(report,openClaim){
 const section=el('section',null,'lens-matrix');
 section.append(el('h4','Which claims share a source?'),
  el('p','Each column is a source URL. One source can support, challenge, or provide context for several claims.'));
 const rows=report.dossier.claims.map(claim=>({claim,groups:claimSourceGroups(claim,report.sources)}));
 const columns=new Map();
 for(const row of rows){
  for(const group of row.groups){
   const column=columns.get(group.url)||{...group,count:0};
   column.count++;columns.set(group.url,column);
  }
 }
 const visible=[...columns.values()].sort((a,b)=>b.count-a.count||a.title.localeCompare(b.title)).slice(0,10);
 if(!visible.length){
  section.append(el('p','No claims have captured sources yet.'));
  return section;
 }
 const scroll=el('div',null,'table-wrap'), table=el('table'), head=el('thead'), header=el('tr'), body=el('tbody');
 const name=el('th','Claim');name.scope='col';header.append(name);
 for(const col of visible){
  const cell=el('th',col.title);cell.scope='col';header.append(cell);
 }
 head.append(header);table.append(head,body);scroll.append(table);section.append(scroll);
 for(const row of rows){
  const tr=el('tr'), label=el('th',row.claim.claim);label.scope='row';tr.append(label);
  for(const col of visible){
   const cell=el('td'), group=row.groups.find(item=>item.url===col.url);
   if(group){
    const roles=[...new Set(group.entries.map(entry=>entry.role))];
    const button=el('button',roles.map(role=>proofRoles[role]).join(' · '));
    button.dataset.role=roles[0];
    button.setAttribute('aria-label',row.claim.claim+' · '+col.title+' · '+button.textContent);
    button.onclick=()=>openClaim(row.claim,button);
    cell.append(button);
   }else cell.textContent='—';
   tr.append(cell);
  }
  body.append(tr);
 }
 if(columns.size>visible.length)section.append(el('p','Showing the 10 most referenced source URLs. Open a claim for all its sources.','meta'));
 return section;
}

function renderStoryChanges(report,refreshStory){
 const section=el('section',null,'lens-changes');
 const heading=el('h4','What changed?'), refresh=el('button','Check for updates');
 const select=el('select'), label=el('label','Saved revision'), result=el('div');
 const feedback=el('p',null,'meta');
 feedback.setAttribute('role','status');label.append(select);label.hidden=true;
 section.append(heading,refresh,feedback,label,result);
 refresh.onclick=async()=>{
  refresh.disabled=true;feedback.textContent='Sending update request to Codex…';
  try{
   await refreshStory();
   feedback.textContent='Update requested. This view refreshes after the story is saved.';
  }catch(error){feedback.textContent=error.message;refresh.disabled=false;}
 };
 let request=0;
 async function load(revision){
  const sequence=++request;
  result.textContent='Loading revision history…';
  try{
   const args={evidence_id:report.evidence_id};
   if(revision)args.revision_id=Number(revision);
   const data=await api('story_changes',args);
   if(sequence!==request)return;
   result.replaceChildren();
   if(data.history.length>1){
    select.replaceChildren(...data.history.map(item=>{
     const option=el('option','#'+item.id+' · '+new Date(item.saved_at).toLocaleString());
     option.value=String(item.id);return option;
    }));
    select.value=String(data.current.id);label.hidden=false;
   }
   if(!data.previous){
    result.append(el('p','First saved version. Future changes to claims and sources will appear here.'));
    return;
   }
   result.append(el('p','Revision '+data.previous.id+' → '+data.current.id,'meta'));
   function list(title,items,render){
    if(!items.length)return;
    const list=el('ul');
    for(const value of items){const item=el('li');render(item,value);list.append(item);}
    result.append(el('h5',title),list);
   }
   list('Verdicts that changed',data.verdicts,(item,value)=>{
    item.append(el('p',value.after.claim),el('p',value.before.verdict+' → '+value.after.verdict,'meta'),
     el('p',value.after.reason));
    references(item,value.after.evidence_ids,data.sources);
   });
   list('Evidence links that changed',data.claim_evidence_updates,(item,claim)=>{
    item.append(el('p',claim.claim));
    references(item,claim.evidence_ids,data.sources);
   });
   list('New claims',data.added_claims,(item,claim)=>item.append(el('p',claim.claim)));
   list('Claims removed from the report',data.removed_claims,(item,claim)=>item.append(el('p',claim.claim)));
   for(const [title,items] of [['Sources added',data.added_sources],['Sources with changed captures',data.revised_sources],
    ['Sources removed from the report',data.removed_sources]]){
    list(title,items,(item,source)=>{const original=link(source.url);original.textContent=source.title||source.url;item.append(original);});
   }
   if(result.childElementCount===1)result.append(el('p','The report changed. No claim verdicts or cited source records changed.'));
  }catch(error){if(sequence===request)result.textContent=error.message;}
 }
 select.onchange=()=>load(select.value);
 load();
 return section;
}
