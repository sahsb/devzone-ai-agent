const $ = (id) => document.getElementById(id);
const state = { mode: "build", signup: false, user: null, conversationId: null, busy: false };
const modeLabels = { build: "Build with AI", debug: "Debug code", learn: "Learn coding" };

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function showAuth() {
  $("authView").classList.remove("hidden");
  $("workspace").classList.add("hidden");
}
function showWorkspace(user) {
  state.user = user;
  $("authView").classList.add("hidden");
  $("workspace").classList.remove("hidden");
  $("userName").textContent = user.name || user.email;
  $("avatar").textContent = (user.name || user.email || "D").charAt(0).toUpperCase();
  loadHistory();
}
function setSignup(value) {
  state.signup = value;
  $("loginTab").classList.toggle("active", !value);
  $("signupTab").classList.toggle("active", value);
  $("name").classList.toggle("hidden", !value);
  $("nameLabel").classList.toggle("hidden", !value);
  $("password").autocomplete = value ? "new-password" : "current-password";
  $("authHeading").innerHTML = value
    ? "<h2>Create your account</h2><p class='muted'>Your private coding workspace starts here.</p>"
    : "<h2>Welcome back</h2><p class='muted'>Sign in to continue to your workspace.</p>";
  $("authSubmit").innerHTML = value ? "Create account <span>→</span>" : "Sign in <span>→</span>";
  $("authMessage").textContent = "";
}
$("loginTab").addEventListener("click", () => setSignup(false));
$("signupTab").addEventListener("click", () => setSignup(true));

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("authSubmit");
  button.disabled = true;
  $("authMessage").textContent = "Please wait…";
  try {
    const payload = { email: $("email").value.trim(), password: $("password").value };
    if (state.signup) payload.name = $("name").value.trim();
    const data = await api(state.signup ? "/api/auth/signup" : "/api/auth/login", {
      method: "POST", body: JSON.stringify(payload)
    });
    showWorkspace(data.user);
  } catch (err) {
    $("authMessage").textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("selected", item.dataset.mode === mode));
  $("modeName").textContent = modeLabels[mode] || modeLabels.build;
  $("promptInput").placeholder = mode === "debug" ? "Paste your error or describe the bug…" : mode === "learn" ? "What do you want to learn today…" : "Ask DVOZON to build, explain, or debug code…";
}
document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => {
  setMode(item.dataset.mode);
  closeSidebar();
}));
function newSession() {
  state.conversationId = null;
  $("conversation").innerHTML = "";
  $("conversation").classList.add("hidden");
  $("welcomePanel").classList.remove("hidden");
  $("promptInput").value = "";
  $("promptInput").focus();
}
$("newChat").addEventListener("click", () => { newSession(); closeSidebar(); });
document.querySelectorAll(".prompt-card").forEach((card) => card.addEventListener("click", () => {
  $("promptInput").value = card.dataset.prompt;
  $("promptInput").focus();
  autoGrow();
}));

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebarShade").classList.remove("show");
}
$("openSidebar").addEventListener("click", () => {
  $("sidebar").classList.add("open");
  $("sidebarShade").classList.add("show");
});
$("closeSidebar").addEventListener("click", closeSidebar);
$("sidebarShade").addEventListener("click", closeSidebar);
$("refreshHistory").addEventListener("click", loadHistory);

async function loadHistory() {
  try {
    const data = await api("/api/conversations");
    const list = $("historyList");
    list.innerHTML = "";
    if (!data.conversations.length) {
      list.innerHTML = '<p class="history-empty">Your sessions will appear here.</p>';
      return;
    }
    data.conversations.forEach((item) => {
      const button = document.createElement("button");
      button.className = "history-item";
      button.textContent = item.title;
      button.title = item.title;
      button.addEventListener("click", () => openConversation(item.id));
      list.appendChild(button);
    });
  } catch (err) {
    if (err.message.includes("log in") || err.message.includes("Session expired")) showAuth();
  }
}
async function openConversation(id) {
  try {
    const data = await api(`/api/conversations/${id}/messages`);
    state.conversationId = id;
    $("welcomePanel").classList.add("hidden");
    $("conversation").classList.remove("hidden");
    $("conversation").innerHTML = "";
    data.messages.forEach(addMessage);
    closeSidebar();
    scrollBottom();
  } catch (err) { toast(err.message); }
}
function addMessage(message) {
  const row = document.createElement("article");
  row.className = `message ${message.role}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = message.role === "user" ? (state.user?.name || "Y").charAt(0).toUpperCase() : "✦";
  const body = document.createElement("div");
  body.className = "message-body";
  const role = document.createElement("div");
  role.className = "message-role";
  role.textContent = message.role === "user" ? "You" : "DVOZON AI";
  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = message.content;
  body.append(role, content);
  row.append(avatar, body);
  $("conversation").appendChild(row);
  return row;
}
function scrollBottom() {
  $("contentScroll").scrollTop = $("contentScroll").scrollHeight;
}
function autoGrow() {
  const input = $("promptInput");
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
}
$("promptInput").addEventListener("input", autoGrow);
$("promptInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
$("sendBtn").addEventListener("click", sendMessage);

async function sendMessage() {
  if (state.busy) return;
  const prompt = $("promptInput").value.trim();
  if (!prompt) { $("promptInput").focus(); return; }
  state.busy = true;
  $("sendBtn").disabled = true;
  $("promptInput").disabled = true;
  $("welcomePanel").classList.add("hidden");
  $("conversation").classList.remove("hidden");
  addMessage({ role: "user", content: prompt });
  $("promptInput").value = "";
  autoGrow();
  const waiting = addMessage({ role: "assistant", content: "DVOZON is thinking…" });
  waiting.querySelector(".message-content").classList.add("typing");
  scrollBottom();
  try {
    const data = await api("/api/agent/chat", {
      method: "POST",
      body: JSON.stringify({ prompt, mode: state.mode, conversationId: state.conversationId })
    });
    state.conversationId = data.conversationId;
    waiting.querySelector(".message-content").classList.remove("typing");
    waiting.querySelector(".message-content").textContent = data.reply;
    if (data.demo) toast("Demo mode: add an AI API key to enable live AI.");
    loadHistory();
  } catch (err) {
    waiting.querySelector(".message-content").classList.remove("typing");
    waiting.querySelector(".message-content").textContent = "Error: " + err.message;
  } finally {
    state.busy = false;
    $("sendBtn").disabled = false;
    $("promptInput").disabled = false;
    $("promptInput").focus();
    scrollBottom();
  }
}

$("logout").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch {}
  state.user = null;
  state.conversationId = null;
  showAuth();
  setSignup(false);
  $("password").value = "";
  toast("You have been logged out.");
});

(async function init() {
  try {
    const data = await api("/api/auth/me");
    showWorkspace(data.user);
  } catch {
    showAuth();
  }
})();
