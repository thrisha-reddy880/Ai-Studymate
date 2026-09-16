const state = {
  token: localStorage.getItem("studymate_token"),
  user: null,
  data: { subjects: [], tasks: [], flashcards: [], attempts: [], sessions: [], stats: {} },
  page: "dashboard",
  flashIndex: 0,
  flashList: [],
  flashFilter: "all",
  quiz: [],
  quizIndex: 0,
  quizAnswers: {},
  timerSeconds: 25 * 60,
  timerRunning: false,
  timerId: null,
  chatHistory: []
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

async function api(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) logout(false);
    throw new Error(data.error || "Something went wrong.");
  }
  return data;
}

function setAuthError(msg) { $("#authError").textContent = msg || ""; }

function showApp() {
  $("#authScreen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#userName").textContent = state.user.name.split(" ")[0];
  $("#userInitial").textContent = state.user.name.trim().charAt(0).toUpperCase();
  const h = new Date().getHours();
  $("#greeting").textContent = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

function showAuth() { $("#authScreen").classList.remove("hidden"); $("#app").classList.add("hidden"); }

function logout(show = true) {
  clearInterval(state.timerId);
  localStorage.removeItem("studymate_token");
  state.token = null; state.user = null;
  showAuth();
  if (show) toast("Logged out.");
}

async function loadData() {
  state.data = await api("/api/dashboard");
  renderAll();
}

function navigate(page) {
  state.page = page;
  $$(".page").forEach(x => x.classList.remove("active-page"));
  $(`#page-${page}`).classList.add("active-page");
  $$(".nav-links button,.mobile-nav button").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  $("#mobileNav").classList.add("hidden");
  if (page === "flashcards") initFlashcards();
  if (page === "quiz") startQuiz();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAll() {
  const d = state.data;
  $("#statStudy").textContent = d.stats.studyHours ? `${d.stats.studyHours}h ${d.stats.studyRemainder}m` : `${d.stats.studyRemainder}m`;
  $("#statTasks").textContent = `${d.stats.taskCompletion}%`;
  $("#statStreak").textContent = `${d.stats.streak} day${d.stats.streak === 1 ? "" : "s"}`;
  $("#statQuiz").textContent = `${d.stats.averageQuiz}%`;
  renderDashboardTasks(); renderSubjects(); renderTasks(); renderFlashFilters(); renderProgress(); renderDashboardActivity(); updateAIStatus();
}

function renderDashboardActivity() {
  const el = $("#dashActivity");
  const attempts = (state.data.attempts || []).slice(0, 3).map(a => `<div class="activity-item"><i class="fa-solid fa-circle-check"></i><span>Quiz completed</span><strong>${a.score}%</strong></div>`);
  const sessions = (state.data.sessions || []).slice(0, 3).map(s => `<div class="activity-item"><i class="fa-solid fa-clock"></i><span>Focus session</span><strong>${s.minutes}m</strong></div>`);
  const items = [...attempts, ...sessions].slice(0, 4);
  el.innerHTML = items.length ? items.join("") : `<div class="empty">No activity yet. Complete a task, quiz or focus session to see it here.</div>`;
}

async function updateAIStatus() {
  const el = $("#aiStatus"); if (!el || !state.token) return;
  try { const r = await api("/api/ai/status"); el.innerHTML = r.configured ? '<i class="fa-solid fa-circle"></i> Live AI connected' : '<i class="fa-solid fa-circle"></i> AI setup needed — add OPENAI_API_KEY'; el.classList.toggle("ai-ready", !!r.configured); } catch { el.innerHTML = '<i class="fa-solid fa-circle"></i> AI status unavailable'; }
}

function renderDashboardTasks() {
  const list = $("#dashTasks");
  const tasks = state.data.tasks.slice().sort((a,b) => Number(a.completed)-Number(b.completed)).slice(0,5);
  if (!tasks.length) { list.innerHTML = `<div class="empty">No tasks yet.<br><button class="text-btn" data-page="tasks">Add your first study task →</button></div>`; return; }
  list.innerHTML = tasks.map(taskRow).join("");
}

function taskRow(t) {
  return `<div class="task-row"><button class="check ${t.completed ? "done":""}" data-toggle-task="${t.id}">${t.completed ? '<i class="fa-solid fa-check"></i>':""}</button><div><strong>${escapeHtml(t.title)}</strong><small>${subjectName(t.subjectId)} · ${t.minutes} min</small></div></div>`;
}

function subjectName(id) { return state.data.subjects.find(s => s.id === id)?.name || "General"; }

function renderSubjects() {
  const grid = $("#subjectsGrid");
  const minis = $("#dashSubjects");
  if (!state.data.subjects.length) {
    grid.innerHTML = `<div class="empty">No subjects yet. Add the subjects you actually study.</div>`;
    minis.innerHTML = `<div class="empty">Add your first subject.</div>`;
    return;
  }
  grid.innerHTML = state.data.subjects.map(s => {
    const pct = s.totalTasks ? Math.round(s.completedTasks/s.totalTasks*100) : 0;
    return `<article class="panel subject-card"><button class="delete-btn" data-delete-subject="${s.id}" title="Delete subject"><i class="fa-solid fa-trash"></i></button><span><i class="subject-dot" style="background:${s.color}"></i>${escapeHtml(s.name)}</span><h3>${pct}% complete</h3><p>${s.completedTasks} of ${s.totalTasks} tasks completed</p><div class="subject-progress"><span style="width:${pct}%;background:${s.color}"></span></div></article>`;
  }).join("");
  minis.innerHTML = state.data.subjects.map(s => `<div class="subject-mini"><i class="fa-solid fa-book" style="color:${s.color}"></i><strong>${escapeHtml(s.name)}</strong><small>${s.completedTasks}/${s.totalTasks}</small></div>`).join("");
}

function renderTasks() {
  const list = $("#tasksList");
  if (!state.data.tasks.length) { list.innerHTML = `<div class="empty">No tasks created yet.<br><button class="text-btn" id="emptyAddTask">+ Create your first task</button></div>`; return; }
  list.innerHTML = state.data.tasks.slice().sort((a,b)=>Number(a.completed)-Number(b.completed)).map(t => `<article class="task-card ${t.completed?"completed":""}"><button class="check ${t.completed?"done":""}" data-toggle-task="${t.id}">${t.completed?'<i class="fa-solid fa-check"></i>':""}</button><div><strong>${escapeHtml(t.title)}</strong><div class="meta">${escapeHtml(subjectName(t.subjectId))} · ${t.minutes} min${t.dueDate?` · Due ${t.dueDate}`:""}</div></div><span class="priority ${t.priority}">${t.priority}</span><button class="delete-btn" data-delete-task="${t.id}" title="Delete"><i class="fa-solid fa-trash"></i></button></article>`).join("");
}

function renderFlashFilters() {
  const select = $("#flashSubjectFilter");
  const current = select.value || "all";
  select.innerHTML = `<option value="all">All subjects</option>` + state.data.subjects.map(s=>`<option value="${escapeAttr(s.name)}">${escapeHtml(s.name)}</option>`).join("");
  select.value = [...select.options].some(o=>o.value===current) ? current : "all";
}

function initFlashcards() {
  const filter = $("#flashSubjectFilter").value || "all";
  state.flashFilter = filter;
  state.flashList = state.data.flashcards.filter(f => filter === "all" || f.subject === filter);
  if (!state.flashList.length) state.flashIndex = 0;
  else state.flashIndex = Math.min(state.flashIndex, state.flashList.length - 1);
  renderFlashcard();
}

function renderFlashcard() {
  const card = state.flashList[state.flashIndex];
  $("#flashcard").classList.remove("flipped");
  $("#flashFront").textContent = card?.front || "No flashcards found.";
  $("#flashBack").textContent = card?.back || "Add a card to start.";
  $("#flashPosition").textContent = `${state.flashList.length ? state.flashIndex + 1 : 0} / ${state.flashList.length || 0}`;
  $("#flashCount").textContent = `${state.flashList.length} cards`;
}

function renderProgress() {
  const pct = state.data.stats.taskCompletion || 0;
  $("#progressPercent").textContent = `${pct}%`;
  $("#progressFill").style.width = `${pct}%`;
  $("#quizHistory").innerHTML = state.data.attempts.length ? state.data.attempts.map(a=>`<div class="history-item"><span>${escapeHtml(a.subject)}</span><strong>${a.score}%</strong></div>`).join("") : `<div class="empty">No quiz attempts yet.</div>`;
  $("#sessionHistory").innerHTML = state.data.sessions.length ? state.data.sessions.map(s=>`<div class="history-item"><span>${new Date(s.date).toLocaleDateString()}</span><strong>${s.minutes} min</strong></div>`).join("") : `<div class="empty">No study sessions yet.</div>`;
}

function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/`/g, ""); }

function openModal(html) { $("#modalContent").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); $("#modalContent").innerHTML = ""; }

function subjectOptions() {
  return `<option value="">General / no subject</option>` + state.data.subjects.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
}

function addSubjectModal() {
  openModal(`<h3>Add a subject</h3><form id="subjectForm" class="modal-form"><label>Subject name<input name="name" placeholder="e.g. Computer Networks" required></label><label>Accent color<input name="color" type="color" value="#8b5cf6"></label><button class="primary-btn" type="submit">Add subject</button></form>`);
  $("#subjectForm").onsubmit = async e => { e.preventDefault(); try { const f=new FormData(e.currentTarget); await api("/api/subjects",{method:"POST",body:JSON.stringify({name:f.get("name"),color:f.get("color")})}); closeModal(); await loadData(); toast("Subject added."); } catch(err){toast(err.message)} };
}

function addTaskModal() {
  if (!state.data.subjects.length) { toast("Add a subject first."); navigate("subjects"); return; }
  openModal(`<h3>Create a study task</h3><form id="taskForm" class="modal-form"><label>Task title<input name="title" placeholder="e.g. Revise binary trees" required></label><div class="row"><label>Subject<select name="subjectId">${subjectOptions()}</select></label><label>Duration (minutes)<input name="minutes" type="number" min="5" max="600" value="30"></label></div><div class="row"><label>Priority<select name="priority"><option>low</option><option selected>medium</option><option>high</option></select></label><label>Due date<input name="dueDate" type="date"></label></div><button class="primary-btn" type="submit">Add to my tasks</button></form>`);
  $("#taskForm").onsubmit = async e => { e.preventDefault(); const f=new FormData(e.currentTarget); try { await api("/api/tasks",{method:"POST",body:JSON.stringify(Object.fromEntries(f.entries()))}); closeModal(); await loadData(); toast("Task added."); } catch(err){toast(err.message)} };
}

function addFlashcardModal() {
  openModal(`<h3>Create a flashcard</h3><form id="flashForm" class="modal-form"><label>Subject<input name="subject" placeholder="e.g. Machine Learning"></label><label>Question<input name="front" placeholder="What is gradient descent?" required></label><label>Answer<textarea name="back" placeholder="Write the explanation..." required></textarea></label><button class="primary-btn" type="submit">Save flashcard</button></form>`);
  $("#flashForm").onsubmit = async e => { e.preventDefault(); const f=new FormData(e.currentTarget); try { await api("/api/flashcards",{method:"POST",body:JSON.stringify(Object.fromEntries(f.entries()))}); closeModal(); await loadData(); initFlashcards(); toast("Flashcard saved."); } catch(err){toast(err.message)} };
}

async function toggleTask(id) {
  const task = state.data.tasks.find(t=>t.id===id); if (!task) return;
  try { await api(`/api/tasks/${id}`,{method:"PATCH",body:JSON.stringify({completed:!task.completed})}); await loadData(); toast(task.completed ? "Task reopened." : "Task completed!"); } catch(e){toast(e.message)}
}

async function deleteSubject(id) {
  if (!confirm("Delete this subject and its tasks?")) return;
  try { await api(`/api/subjects/${id}`,{method:"DELETE"}); await loadData(); toast("Subject deleted."); } catch(e){toast(e.message)}
}

async function deleteTask(id) {
  if (!confirm("Delete this task?")) return;
  try { await api(`/api/tasks/${id}`,{method:"DELETE"}); await loadData(); toast("Task deleted."); } catch(e){toast(e.message)}
}

async function sendChat(text) {
  const input = $("#chatInput");
  const message = text || input.value.trim();
  if (!message) return;
  if (!text) input.value = "";
  appendChat("user", message);
  const loading = document.createElement("div"); loading.className="chat-bubble ai"; loading.innerHTML=`<span class="chat-avatar"><i class="fa-solid fa-sparkles"></i></span><div><strong>AI StudyMate</strong><p><span class="spinner"></span> Thinking...</p></div>`; $("#chatMessages").appendChild(loading); $("#chatMessages").scrollTop=$("#chatMessages").scrollHeight;
  try {
    const result = await api("/api/ai/chat",{method:"POST",body:JSON.stringify({message,history:state.chatHistory})});
    loading.remove(); appendChat("ai", result.answer);
    state.chatHistory.push({role:"user",content:message},{role:"assistant",content:result.answer});
    if (state.chatHistory.length > 12) state.chatHistory = state.chatHistory.slice(-12);
  } catch(e) { loading.remove(); appendChat("ai", "Sorry, I couldn't connect right now. " + e.message); }
}
function appendChat(role, text) {
  const el=document.createElement("div"); el.className=`chat-bubble ${role}`; el.innerHTML=`<span class="chat-avatar">${role==="ai"?'<i class="fa-solid fa-sparkles"></i>':escapeHtml(state.user.name.charAt(0))}</span><div><strong>${role==="ai"?"AI StudyMate":"You"}</strong><p>${escapeHtml(text).replace(/\n/g,"<br>")}</p></div>`; $("#chatMessages").appendChild(el); $("#chatMessages").scrollTop=$("#chatMessages").scrollHeight;
}

async function generateInsight() {
  $("#insightBtn").disabled=true; $("#insightBtn").innerHTML=`<span class="spinner"></span> Thinking`;
  try { const r=await api("/api/ai/insights",{method:"POST"}); $("#insightText").textContent=r.insight; $("#insightTitle").textContent="A note for you"; } catch(e){toast(e.message)} finally {$("#insightBtn").disabled=false;$("#insightBtn.textContent");$("#insightBtn").textContent="Refresh insight";}
}

async function startQuiz() {
  try { state.quiz=await api("/api/quiz"); state.quizIndex=0; state.quizAnswers={}; renderQuiz(); } catch(e){toast(e.message)}
}
function renderQuiz() {
  const q=state.quiz[state.quizIndex]; if(!q)return;
  $("#quizArea").innerHTML=`<div class="quiz-head"><span class="eyebrow">QUESTION ${state.quizIndex+1} OF ${state.quiz.length}</span><div class="progress-track" style="margin:12px 0 24px"><span style="width:${(state.quizIndex/state.quiz.length)*100}%"></span></div><div class="quiz-q">${escapeHtml(q.question)}</div></div><div class="quiz-options">${q.options.map((o,i)=>`<button class="quiz-option ${state.quizAnswers[q.id]===i?"selected":""}" data-answer="${i}">${String.fromCharCode(65+i)}. ${escapeHtml(o)}</button>`).join("")}</div><div class="quiz-footer"><span>${Object.keys(state.quizAnswers).length} answered</span><button id="quizNext" class="primary-btn">${state.quizIndex===state.quiz.length-1?"Finish quiz":"Next"} <i class="fa-solid fa-arrow-right"></i></button></div>`;
}
async function finishQuiz() {
  let correct=0; state.quiz.forEach(q=>{if(state.quizAnswers[q.id]===q.answer)correct++}); const score=Math.round(correct/state.quiz.length*100);
  try { await api("/api/quiz/submit",{method:"POST",body:JSON.stringify({score,total:state.quiz.length,subject:"Mixed revision"})}); await loadData(); $("#quizArea").innerHTML=`<div style="text-align:center;padding:55px 10px"><span class="eyebrow">QUIZ COMPLETE</span><div class="big-progress"><strong>${score}%</strong></div><p>You got ${correct} out of ${state.quiz.length} correct.</p><button id="retake" class="primary-btn" style="margin-top:20px">Try another quiz</button></div>`; $("#retake").onclick=startQuiz; } catch(e){toast(e.message)}
}

function resetTimer() { clearInterval(state.timerId); state.timerRunning=false; state.timerSeconds=25*60; updateTimer(); }
function updateTimer() { const m=Math.floor(state.timerSeconds/60).toString().padStart(2,"0"),s=(state.timerSeconds%60).toString().padStart(2,"0"); $("#dashTimer").textContent=`${m}:${s}`; $("#dashTimerBtn").textContent=state.timerRunning?"Pause":"Start"; }
function toggleTimer() {
  if(state.timerRunning){clearInterval(state.timerId);state.timerRunning=false;updateTimer();return}
  state.timerRunning=true;updateTimer();state.timerId=setInterval(async()=>{state.timerSeconds--;updateTimer();if(state.timerSeconds<=0){clearInterval(state.timerId);state.timerRunning=false;await api("/api/sessions",{method:"POST",body:JSON.stringify({minutes:25})});toast("Focus session complete!");await loadData();resetTimer()}},1000);
}

document.addEventListener("click", async e => {
  const pageBtn=e.target.closest("[data-page]"); if(pageBtn){navigate(pageBtn.dataset.page);return}
  const toggle=e.target.closest("[data-toggle-task]"); if(toggle){await toggleTask(toggle.dataset.toggleTask);return}
  const delS=e.target.closest("[data-delete-subject]"); if(delS){await deleteSubject(delS.dataset.deleteSubject);return}
  const delT=e.target.closest("[data-delete-task]"); if(delT){await deleteTask(delT.dataset.deleteTask);return}
  const ask=e.target.closest("[data-ask]"); if(ask){navigate("tutor");sendChat(ask.dataset.ask);return}
  if(e.target.id==="emptyAddTask") addTaskModal();
  if(e.target.closest(".suggestions button")) sendChat(e.target.closest("button").textContent);
  if(e.target.closest(".quiz-option")) { const b=e.target.closest(".quiz-option"); state.quizAnswers[state.quiz[state.quizIndex].id]=Number(b.dataset.answer);renderQuiz(); }
  if(e.target.id==="quizNext"){if(state.quizIndex===state.quiz.length-1)finishQuiz();else{state.quizIndex++;renderQuiz()}}
});

$("#loginForm").onsubmit=async e=>{e.preventDefault();setAuthError("");try{const r=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:$("#loginEmail").value,password:$("#loginPassword").value})});state.token=r.token;state.user=r.user;localStorage.setItem("studymate_token",state.token);showApp();await loadData()}catch(err){setAuthError(err.message)}};
$("#registerForm").onsubmit=async e=>{e.preventDefault();setAuthError("");try{const r=await api("/api/auth/register",{method:"POST",body:JSON.stringify({name:$("#regName").value,email:$("#regEmail").value,password:$("#regPassword").value})});state.token=r.token;state.user=r.user;localStorage.setItem("studymate_token",state.token);showApp();await loadData();toast("Welcome to AI StudyMate!")}catch(err){setAuthError(err.message)}};
$$(".auth-tab").forEach(tab=>tab.onclick=()=>{$$(".auth-tab").forEach(x=>x.classList.remove("active"));tab.classList.add("active");const reg=tab.dataset.auth==="register";$("#loginForm").classList.toggle("hidden",reg);$("#registerForm").classList.toggle("hidden",!reg);setAuthError("")});
$("#logoutBtn").onclick=()=>logout(true);
$("#mobileMenuBtn").onclick=()=>$("#mobileNav").classList.toggle("hidden");
$("#modalClose").onclick=closeModal;$(".modal-backdrop").onclick=closeModal;
$("#addSubjectBtn").onclick=addSubjectModal;$("#addTaskBtn").onclick=addTaskModal;$("#addFlashcardBtn").onclick=addFlashcardModal;
$("#flashcard").onclick=()=>$("#flashcard").classList.toggle("flipped");
$("#prevCard").onclick=()=>{if(!state.flashList.length)return;state.flashIndex=(state.flashIndex-1+state.flashList.length)%state.flashList.length;renderFlashcard()};
$("#nextCar