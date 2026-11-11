function renderArgumentMap(panel, report) {
 const dossier = report.dossier;
 const controls = el('div', null, 'atlas-map-controls');
 const filter = el('select');
 filter.setAttribute('aria-label', 'Filter claim verdicts');
 for (const name of ['All verdicts', 'supported', 'partly supported', 'contradicted', 'unresolved']) {
  const option = el('option', name);
  option.value = name;
  filter.append(option);
 }
 const play = el('button', 'Play argument walkthrough');
 const reset = el('button', 'Show whole argument');
 const count = el('span', '', 'meta');
 controls.append(filter, play, reset, count);
 const scroll = el('div', null, 'atlas-map-scroll');
 const canvas = el('div', null, 'atlas-map');
 const wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
 wires.classList.add('atlas-wires');
 wires.setAttribute('aria-hidden', 'true');
 const detail = el('section', null, 'card');
 detail.setAttribute('aria-live', 'polite');
 panel.append(el('h3', 'How the argument connects'),
  el('p', 'Speaker → claim → cited evidence. A connection means the source was used to assess the claim. Select a node to inspect it.'),
  controls, scroll, detail);
 scroll.append(canvas);
 let timer, selected, buttons = new Map(), edges = [], step = 0;
 const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 function stop() { clearInterval(timer); timer = null; play.textContent = 'Play argument walkthrough'; }
 function inspect(node) {
  selected = node.key;
  const connected = new Set([selected]);
  for (const [from, to] of edges) {
   if (from === selected) connected.add(to);
   if (to === selected) connected.add(from);
  }
  for (const [key, button] of buttons) {
   button.classList.toggle('atlas-dim', !connected.has(key));
   button.setAttribute('aria-pressed', key === selected);
  }
  detail.replaceChildren(el('h3', node.title), el('p', node.text));
  if (node.url) detail.append(link(node.url));
  if (node.refs) references(detail, node.refs, report.sources);
  drawWires();
 }
 function drawWires() {
  wires.replaceChildren();
  const bounds = canvas.getBoundingClientRect();
  wires.setAttribute('width', canvas.scrollWidth);
  wires.setAttribute('height', canvas.scrollHeight);
  for (const [from, to] of edges) {
   const a = buttons.get(from), b = buttons.get(to);
   if (!a || !b) continue;
   const first = a.getBoundingClientRect(), second = b.getBoundingClientRect();
   const x1 = first.right - bounds.left, y1 = first.top + first.height / 2 - bounds.top;
   const x2 = second.left - bounds.left, y2 = second.top + second.height / 2 - bounds.top;
   const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
   path.setAttribute('d', 'M '+x1+' '+y1+' C '+(x1+30)+' '+y1+' '+(x2-30)+' '+y2+' '+x2+' '+y2);
   path.setAttribute('class', selected === from || selected === to ? 'atlas-wire active' : 'atlas-wire');
   wires.append(path);
  }
 }
 function draw() {
  stop(); selected = null; buttons = new Map(); edges = [];
  canvas.replaceChildren(wires);
  const columns = ['Speakers', 'Claims and checks', 'Evidence'].map(label => {
   const column = el('div', null, 'atlas-map-column');
   column.append(el('h3', label));canvas.append(column);return column;
  });
  function node(column, data) {
   if (buttons.has(data.key)) return;
   const button = el('button', null, 'atlas-node');
   button.append(el('span', data.label || data.title), el('span', data.kind, 'meta'));
   button.onclick = () => { stop(); inspect(data); };
   button.setAttribute('aria-pressed', 'false');
   buttons.set(data.key, button);column.append(button);
  }
  const visible = dossier.claims.map((claim, index) => ({claim, index}))
   .filter(({claim}) => filter.value === 'All verdicts' || claim.verdict === filter.value);
  for (const {claim, index} of visible) {
   const speakerKey = 'speaker:'+claim.speaker, claimKey = 'claim:'+index;
   const person = dossier.participants.find(p => p.handle === claim.speaker);
   node(columns[0], {key:speakerKey, title:claim.speaker,
    text:person?.position || 'This label describes the comparison being assessed.',
    kind:person ? 'Participant' : 'Analytical framing', url:person?.profile_url});
   node(columns[1], {key:claimKey, title:claim.claim, text:claim.reason,
    kind:claim.attribution==='inferred'?'Inferred comparison':claim.verdict, refs:claim.evidence_ids});
   edges.push([speakerKey, claimKey]);
   for (const id of claim.evidence_ids) {
    const source = report.sources[id];
    if (!source) continue;
    node(columns[2], {key:'source:'+id, title:source.title || source.article_url,
     text:source.excerpt, kind:'Source record', url:source.article_url, refs:[id]});
    edges.push([claimKey, 'source:'+id]);
   }
  }
  count.textContent = visible.length+' claims · '+new Set(edges.filter(e=>e[1].startsWith('source:')).map(e=>e[1])).size+' sources';
  detail.replaceChildren(el('p', visible.length ? 'Select a claim to see the verdict, reasoning and source records.' : 'No claims have this verdict.'));
  requestAnimationFrame(drawWires);
 }
 filter.onchange = draw;
 reset.onclick = () => { filter.value = 'All verdicts'; draw(); };
 play.onclick = () => {
  if (timer) { stop(); return; }
  const claims = [...buttons.keys()].filter(key => key.startsWith('claim:'));
  if (!claims.length) return;
  step = 0;
  function advance() {
   if (!panel.isConnected || step >= claims.length) { stop(); return; }
   const key = claims[step++], claim = dossier.claims[Number(key.split(':')[1])];
   inspect({key, title:claim.claim, text:claim.reason, refs:claim.evidence_ids});
   buttons.get(key).scrollIntoView({behavior:reduced ? 'auto':'smooth', block:'nearest', inline:'nearest'});
  }
  advance();timer=setInterval(advance, 4500);play.textContent='Pause walkthrough';
 };
 const resize = new ResizeObserver(() => { if(panel.isConnected)drawWires(); else resize.disconnect(); });
 resize.observe(canvas);
 panel.addEventListener('atlas:dispose', () => { stop(); resize.disconnect(); }, {once:true});
 draw();
}
