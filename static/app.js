const docSelect = document.getElementById('docSelect');
const docList = document.getElementById('docList');
const progress = document.getElementById('progress');
const feed = document.getElementById('feed');
const qInput = document.getElementById('qInput');
const askBtn = document.getElementById('askBtn');
let activeDocId = null;
let running = false;

function clearEmpty(){ const e = feed.querySelector('.empty'); if(e) e.remove(); }

function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Minimal, dependency-free markdown renderer for the AI's final answer.
// Escapes HTML first (so nothing from the model/document can inject markup),
// then turns #/##/### headings, **bold**, *italic*, `code`, - / 1. lists,
// and (p. N, cX) style citations into real elements instead of raw symbols.
function renderNotes(raw){
  const inline = (s) => {
    s = s.replace(/\(p\.[^)]{0,80}?\)/g, m => `<span class="cite">${m}</span>`);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    return s;
  };
  const lines = escapeHtml(raw).split('\n');
  let html = '', inUl = false, inOl = false;
  const closeLists = () => {
    if(inUl){ html += '</ul>'; inUl = false; }
    if(inOl){ html += '</ol>'; inOl = false; }
  };
  for(const rawLine of lines){
    const line = rawLine.trim();
    if(!line){ closeLists(); continue; }
    let m;
    if((m = line.match(/^(#{1,4})\s+(.*)$/))){
      closeLists();
      const level = Math.min(m[1].length + 2, 5);
      html += `<h${level}>${inline(m[2])}</h${level}>`;
    } else if((m = line.match(/^[-*]\s+(.*)$/))){
      if(!inUl){ closeLists(); html += '<ul>'; inUl = true; }
      html += `<li>${inline(m[1])}</li>`;
    } else if((m = line.match(/^\d+[.)]\s+(.*)$/))){
      if(!inOl){ closeLists(); html += '<ol>'; inOl = true; }
      html += `<li>${inline(m[1])}</li>`;
    } else {
      closeLists();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeLists();
  return html;
}

// Human labels for tool names, used in the call pill.
const TOOL_LABELS = {
  get_index: 'get_index',
  get_chapter_chunks: 'get_chapter_chunks',
  get_chunk: 'get_chunk',
  search_chunks: 'search_chunks',
  semantic_search: 'semantic_search',
};

function renderToolCall(tool, input, desc){
  const pill = `<span class="toolpill">${escapeHtml(TOOL_LABELS[tool] || tool)}</span>`;
  const chips = Object.entries(input || {})
    .map(([k, v]) => `<span class="paramchip">${escapeHtml(k)}: ${escapeHtml(String(v))}</span>`)
    .join('');
  return `<div class="toolcall">${pill}${chips}</div><div class="calldesc">${escapeHtml(desc)}</div>`;
}

// Renders a tool's JSON result as a readable card instead of a raw JSON dump —
// falls back to pretty-printed JSON for any shape it doesn't specifically know.
function renderToolResult(result){
  if(result && typeof result === 'object' && !Array.isArray(result)){
    if('error' in result){
      return `<div class="toolerror">⚠️ ${escapeHtml(result.error)}</div>`;
    }
    if('text' in result && 'id' in result){
      return `<div class="chunkcard">
        <div class="chunkcard-head"><span class="chunkid">${escapeHtml(result.id)}</span><span class="chunkpage">page ${escapeHtml(String(result.page))}</span></div>
        <div class="chunkcard-body">${escapeHtml(truncate(result.text, 1400))}</div>
      </div>`;
    }
    if('chapters' in result && Array.isArray(result.chapters)){
      const rows = result.chapters.map(c => `<div class="chapterrow">
          <span class="chnum">Ch ${escapeHtml(String(c.number))}</span>
          <span class="chtitle">${escapeHtml(c.title)}</span>
          <span class="chmeta">p.${escapeHtml(c.pages)} · ${escapeHtml(String(c.chunk_count))} chunks</span>
        </div>`).join('');
      const hint = result.note ? `<div class="hint">${escapeHtml(result.note)}</div>` : '';
      return `<div class="chapterlist">${rows}</div>${hint}`;
    }
  }
  if(Array.isArray(result)){
    if(result.length === 0){
      return `<div class="toolempty">No matches found.</div>`;
    }
    if(result[0] && typeof result[0] === 'object' && 'preview' in result[0]){
      const rows = result.map(it => `<div class="chunkrow">
          <span class="chunkid">${escapeHtml(it.id)}</span>
          <span class="chunkpage">p.${escapeHtml(String(it.page))}</span>
          <span class="chunkpreview">${escapeHtml(it.preview)}</span>
        </div>`).join('');
      return `<div class="chunklist">${rows}</div>`;
    }
  }
  return `<pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
}

function addBubble({cls, label, body, mono, markdown, toolCall, toolResult}){
  clearEmpty();
  const div = document.createElement('div');
  div.className = 'bubble ' + cls;
  const l = document.createElement('div');
  l.className = 'label';
  l.textContent = label;
  div.appendChild(l);
  const wrap = document.createElement('div');
  if(toolCall){
    wrap.className = 'toolcallwrap';
    wrap.innerHTML = renderToolCall(toolCall.tool, toolCall.input, toolCall.desc);
    div.appendChild(wrap);
  } else if(toolResult !== undefined){
    wrap.className = 'toolresult';
    wrap.innerHTML = renderToolResult(toolResult);
    div.appendChild(wrap);
  } else if(markdown){
    wrap.className = 'notes';
    wrap.innerHTML = renderNotes(body);
    div.appendChild(wrap);
  } else if(mono){
    const pre = document.createElement('pre');
    pre.textContent = body;
    div.appendChild(pre);
  } else {
    const p = document.createElement('div');
    p.style.whiteSpace = 'pre-wrap';
    p.textContent = body;
    div.appendChild(p);
  }
  feed.appendChild(div);
  window.scrollTo(0, document.body.scrollHeight);
  return div;
}

function truncate(s, n){ return s.length > n ? s.slice(0, n) + ' …[truncated]' : s; }

// ---------- documents ----------
async function loadDocuments(){
  const res = await fetch('/api/documents');
  const docs = await res.json();
  docSelect.innerHTML = '<option value="">— select a document —</option>';
  docList.innerHTML = '';
  docs.forEach(d=>{
    const chapterTag = d.chapters > 1 ? `, ${d.chapters} chapters` : '';
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name} (${d.pages}p, ${d.chunks} chunks${chapterTag})`;
    docSelect.appendChild(opt);

    const row = document.createElement('div');
    row.className = 'docRow';
    row.innerHTML = `<span><b>${d.name}</b> — ${d.pages} pages, ${d.chunks} chunks${chapterTag}</span><span class="del" data-id="${d.id}">remove</span>`;
    docList.appendChild(row);
  });
  if(activeDocId) docSelect.value = activeDocId;
}

docList.addEventListener('click', async (e)=>{
  if(e.target.classList.contains('del')){
    const id = e.target.dataset.id;
    await fetch(`/api/documents/${id}`, { method:'DELETE' });
    if(String(activeDocId) === id) activeDocId = null;
    loadDocuments();
  }
});

docSelect.addEventListener('change', ()=>{ activeDocId = docSelect.value || null; });

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function pollJob(jobId){
  while(true){
    const res = await fetch(`/api/upload/status/${jobId}`);
    if(!res.ok){
      const data = await res.json().catch(()=>({error:'Unknown error'}));
      throw new Error(data.error || 'Lost track of the upload job.');
    }
    const job = await res.json();

    if(job.stage === 'error'){
      throw new Error(job.error || 'Upload failed.');
    }
    if(job.stage === 'embedding' && job.total){
      const pct = Math.round((job.done / job.total) * 100);
      progress.textContent = `${job.message} (${pct}%)`;
    } else {
      progress.textContent = job.message || job.stage;
    }
    if(job.stage === 'done'){
      return job.result;
    }
    await sleep(1000);
  }
}

document.getElementById('pdfInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  progress.textContent = `Uploading "${file.name}"…`;
  const form = new FormData();
  form.append('file', file);
  try{
    const startRes = await fetch('/api/upload', { method:'POST', body: form });
    const startData = await startRes.json();
    if(!startRes.ok){ progress.textContent = `Error: ${startData.error}`; return; }

    // Large files (hundreds of pages) are processed in the background —
    // poll for real progress instead of the UI looking stuck.
    const result = await pollJob(startData.job_id);
    progress.textContent = `Saved "${result.name}" — ${result.pages} pages, ${result.chunks} chunks.`;
    activeDocId = result.id;
    await loadDocuments();
  }catch(err){
    progress.textContent = `Upload failed: ${err.message}`;
  }
  e.target.value = '';
});

// ---------- ask: stream the live pipeline ----------
async function runPipeline(question){
  if(!activeDocId){
    addBubble({cls:'b-dead', label:'No Document Selected', body:'Upload and select a PDF from the dropdown before asking a question.'});
    return;
  }

  let thinkingBubble = null;

  const res = await fetch('/api/ask', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ document_id: activeDocId, question })
  });

  if(!res.ok || !res.body){
    addBubble({cls:'b-dead', label:'Connection Error', body:'Could not reach the server.'});
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while(true){
    const {done, value} = await reader.read();
    if(done) break;
    buffer += decoder.decode(value, {stream:true});

    let parts = buffer.split('\n\n');
    buffer = parts.pop();

    for(const part of parts){
      const line = part.split('\n').find(l=>l.startsWith('data: '));
      if(!line) continue;
      const evt = JSON.parse(line.slice(6));
      handleEvent(evt);
    }
  }

  function handleEvent(evt){
    switch(evt.type){
      case 'question':
        addBubble({cls:'b-q', label:'Question', body: evt.text});
        break;
      case 'thinking_start':
        thinkingBubble = addBubble({cls:'b-think', label:'Reasoning', body:''});
        thinkingBubble.querySelector('div').innerHTML = '<span class="pulse"></span> contacting model';
        break;
      case 'ai_thought':
        if(thinkingBubble){ thinkingBubble.remove(); thinkingBubble = null; }
        addBubble({cls:'b-think', label:'Reasoning', body: evt.text});
        break;
      case 'ai_call':
        if(thinkingBubble){ thinkingBubble.remove(); thinkingBubble = null; }
        addBubble({cls:'b-aicall', label:'AI Request', toolCall:{tool:evt.tool, input:evt.input, desc:describeCall(evt)}});
        break;
      case 'code_response':
        addBubble({cls:'b-coderesp', label:'Tool Response', toolResult: evt.result});
        break;
      case 'dead_end':
        if(thinkingBubble){ thinkingBubble.remove(); thinkingBubble = null; }
        addBubble({cls:'b-dead', label:'Unable to Continue', body: evt.text});
        break;
      case 'final_answer':
        if(thinkingBubble){ thinkingBubble.remove(); thinkingBubble = null; }
        addBubble({cls:'b-final', label:'Final Answer', body: evt.text, markdown:true});
        break;
    }
  }

  function describeCall(evt){
    if(evt.tool === 'get_index') return 'Requesting chapter overview';
    if(evt.tool === 'get_chapter_chunks') return `Requesting chunk index for chapter ${evt.input.chapter_number}`;
    if(evt.tool === 'get_chunk') return `Requesting full text of chunk ${evt.input.chunk_id}`;
    if(evt.tool === 'search_chunks') return `Searching document for "${evt.input.keyword}"`;
    if(evt.tool === 'semantic_search') return `Semantic search for "${evt.input.query}"`;
    return '';
  }
}

askBtn.addEventListener('click', async ()=>{
  const q = qInput.value.trim();
  if(!q || running) return;
  running = true;
  askBtn.disabled = true;
  qInput.value = '';
  try{ await runPipeline(q); } finally { running = false; askBtn.disabled = false; }
});
qInput.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); askBtn.click(); }
});

loadDocuments();