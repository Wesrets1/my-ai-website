/* ============================================================
   CONFIG
============================================================ */
const WS_URL = window.location.hostname.endsWith(".ts.net")
  ? `wss://${window.location.hostname}`
  : "ws://localhost:3000";

let ws = null;
let wsReady = false;
let isStreaming = false;

let MODEL = null;
let API_THEME = localStorage.getItem("theme") || "system";
let FONT_SIZE = parseInt(localStorage.getItem("fontSize") || "15", 10);

let chats = {};
let currentChatId = null;
let messages = [];

/* ============================================================
   DOM ELEMENTS
============================================================ */
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const sidebarToggle = document.getElementById("sidebarToggle");
const newChatBtn = document.getElementById("newChatBtn");
const chatListEl = document.getElementById("chatList");

const modelSelector = document.getElementById("modelSelector");
const healthCheckBtn = document.getElementById("healthCheckBtn");
const stopBtn = document.getElementById("stopBtn");

const chatInner = document.getElementById("chatInner");
const input = document.getElementById("input");
const send = document.getElementById("send");

const modalOverlay = document.getElementById("modalOverlay");
const modal = document.getElementById("modal");

/* ============================================================
   THEME SYSTEM
============================================================ */
function applyTheme() {
  let theme = API_THEME;
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    theme = prefersDark ? "dark" : "light";
  }
  document.body.classList.toggle("dark", theme === "dark");
  document.body.style.fontSize = FONT_SIZE + "px";
}

applyTheme();

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (API_THEME === "system") applyTheme();
});

/* ============================================================
   WEBSOCKET
============================================================ */
function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    wsReady = true;
    ws.send(JSON.stringify({ type: "models" }));
  };

  ws.onclose = () => {
    wsReady = false;
    setTimeout(connectWS, 1500);
  };

  ws.onerror = () => {
    wsReady = false;
  };

  ws.onmessage = (event) => handleWS(JSON.parse(event.data));
}

connectWS();

/* ============================================================
   HANDLE WS MESSAGES
============================================================ */
function handleWS(data) {
  if (data.type === "models") {
    populateModels(data.models || []);
    return;
  }

  if (data.type === "health") {
    return;
  }

  if (data.type === "delta") {
    const { assistantIndex, versionIndex, delta } = data;
    const msg = messages[assistantIndex];
    if (!msg) return;
    msg.versions[versionIndex].content += delta;
    renderMessages();
    return;
  }

  if (data.type === "done") {
    isStreaming = false;
    send.disabled = false;
    send.textContent = "Send";
    stopBtn.disabled = true;
    saveChats();
    renderMessages();
    return;
  }

  if (data.type === "stopped") {
    isStreaming = false;
    send.disabled = false;
    send.textContent = "Send";
    stopBtn.disabled = true;
    return;
  }
}

/* ============================================================
   MODEL SELECTOR
============================================================ */
function populateModels(models) {
  modelSelector.innerHTML = "";
  if (!models.length) {
    const opt = document.createElement("option");
    opt.textContent = "No models";
    modelSelector.appendChild(opt);
    return;
  }

  models.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    modelSelector.appendChild(opt);
  });

  const saved = localStorage.getItem("model");
  if (saved && models.includes(saved)) MODEL = saved;
  else MODEL = models[0];

  modelSelector.value = MODEL;
  localStorage.setItem("model", MODEL);
}

modelSelector.onchange = () => {
  MODEL = modelSelector.value;
  localStorage.setItem("model", MODEL);
};

/* ============================================================
   HEALTH & STOP
============================================================ */
healthCheckBtn.onclick = () => {
  if (wsReady) ws.send(JSON.stringify({ type: "health" }));
};

stopBtn.onclick = () => {
  if (wsReady && isStreaming) ws.send(JSON.stringify({ type: "stop" }));
};

/* ============================================================
   CHAT STORAGE
============================================================ */
function loadChats() {
  const raw = localStorage.getItem("chats");
  const current = localStorage.getItem("currentChat");

  chats = raw ? JSON.parse(raw) : {};

  if (current && chats[current]) {
    currentChatId = current;
  } else {
    createNewChat();
  }

  messages = chats[currentChatId].messages;
  refreshChatList();
  renderMessages();
}

function saveChats() {
  localStorage.setItem("chats", JSON.stringify(chats));
  localStorage.setItem("currentChat", currentChatId);
}

function createNewChat() {
  const id = "chat_" + Date.now();
  chats[id] = {
    id,
    title: "New chat",
    systemPrompt: "You are a helpful AI assistant.",
    messages: []
  };
  currentChatId = id;
  messages = chats[id].messages;
  saveChats();
  refreshChatList();
  renderMessages();
}

function refreshChatList() {
  chatListEl.innerHTML = "";
  Object.values(chats).forEach(chat => {
    const item = document.createElement("div");
    item.className = "chat-item" + (chat.id === currentChatId ? " active" : "");
    item.onclick = () => switchChat(chat.id);

    const title = document.createElement("div");
    title.className = "chat-title";
    title.textContent = chat.title;

    const subtitle = document.createElement("div");
    subtitle.className = "chat-subtitle";
    const last = chat.messages.find(m => m.role === "user");
    subtitle.textContent = last ? last.content.slice(0, 40) : "No messages";

    item.appendChild(title);
    item.appendChild(subtitle);
    chatListEl.appendChild(item);
  });
}

function switchChat(id) {
  currentChatId = id;
  messages = chats[id].messages;
  saveChats();
  refreshChatList();
  renderMessages();
  if (window.innerWidth <= 768) document.body.classList.remove("sidebar-open");
}

/* ============================================================
   RENDER MESSAGES
============================================================ */
function renderMessages() {
  chatInner.innerHTML = "";

  messages.forEach((msg, index) => {
    const wrap = document.createElement("div");
    wrap.className = "msg-wrapper";

    // Deleted message placeholder
    if (msg.deleted) {
      const placeholder = document.createElement("div");
      placeholder.className = "deleted-placeholder";
      placeholder.innerHTML = `Message deleted <span class="undo-btn" data-index="${index}">Undo</span>`;
      wrap.appendChild(placeholder);
      chatInner.appendChild(wrap);
      return;
    }

    // EDIT MODE
    if (msg.editing) {
      const textarea = document.createElement("textarea");
      textarea.className = "edit-box";
      textarea.value = msg.content;

      const actions = document.createElement("div");
      actions.className = "edit-actions";

      const saveBtn = document.createElement("button");
      saveBtn.className = "edit-btn";
      saveBtn.textContent = "Save";
      saveBtn.onclick = () => {
        msg.content = textarea.value.trim();
        msg.editing = false;
        saveChats();
        renderMessages();
      };

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "edit-btn";
      cancelBtn.textContent = "Cancel";
      cancelBtn.onclick = () => {
        msg.editing = false;
        renderMessages();
      };

      actions.appendChild(saveBtn);
      actions.appendChild(cancelBtn);

      wrap.appendChild(textarea);
      wrap.appendChild(actions);
      chatInner.appendChild(wrap);
      return;
    }

    // NORMAL MESSAGE BUBBLE
    const bubble = document.createElement("div");
    bubble.className = "msg " + msg.role;

    if (msg.role === "assistant") {
      const v = msg.versions[msg.currentVersion];
      bubble.innerHTML = marked.parse(v.content);
    } else {
      bubble.textContent = msg.content;
    }

    wrap.appendChild(bubble);

    // ACTIONS (Claude-style)
    const actions = document.createElement("div");
    actions.className = "msg-actions";

    // Edit (only user messages)
    if (msg.role === "user") {
      const editBtn = document.createElement("span");
      editBtn.className = "msg-action";
      editBtn.textContent = "Edit";
      editBtn.onclick = () => {
        msg.editing = true;
        renderMessages();
      };
      actions.appendChild(editBtn);
    }

    // Delete (soft delete)
    const deleteBtn = document.createElement("span");
    deleteBtn.className = "msg-action";
    deleteBtn.textContent = "Delete";
    deleteBtn.onclick = () => softDeleteMessage(index);
    actions.appendChild(deleteBtn);

    // Regenerate + Continue (assistant only)
    if (msg.role === "assistant") {
      const regenBtn = document.createElement("span");
      regenBtn.className = "msg-action";
      regenBtn.textContent = "Regenerate";
      regenBtn.onclick = () => regenerateMessage(index);
      actions.appendChild(regenBtn);

      const contBtn = document.createElement("span");
      contBtn.className = "msg-action";
      contBtn.textContent = "Continue";
      contBtn.onclick = () => continueMessage(index);
      actions.appendChild(contBtn);
    }

    wrap.appendChild(actions);

    // VERSION PILLS (assistant only)
    if (msg.role === "assistant" && msg.versions.length > 1) {
      const pills = document.createElement("div");
      pills.className = "version-pills";

      msg.versions.forEach((v, vi) => {
        const pill = document.createElement("div");
        pill.className = "version-pill" + (vi === msg.currentVersion ? " active" : "");
        pill.textContent = "v" + (vi + 1);
        pill.onclick = () => {
          msg.currentVersion = vi;
          saveChats();
          renderMessages();
        };
        pills.appendChild(pill);
      });

      wrap.appendChild(pills);
    }

    chatInner.appendChild(wrap);
  });

  chatInner.scrollTop = chatInner.scrollHeight;

  // Undo buttons
  document.querySelectorAll(".undo-btn").forEach(btn => {
    btn.onclick = () => undoDelete(parseInt(btn.dataset.index));
  });
}

/* ============================================================
   SOFT DELETE + UNDO
============================================================ */
function softDeleteMessage(index) {
  messages[index].deleted = true;
  saveChats();
  renderMessages();

  // Auto-remove undo after 5 seconds
  setTimeout(() => {
    if (messages[index] && messages[index].deleted) {
      messages.splice(index, 1);
      saveChats();
      renderMessages();
    }
  }, 5000);
}

function undoDelete(index) {
  messages[index].deleted = false;
  saveChats();
  renderMessages();
}

/* ============================================================
   SEND MESSAGE
============================================================ */
send.onclick = () => {
  if (isStreaming) return;
  const text = input.value.trim();
  if (!text) return;

  messages.push({
    role: "user",
    content: text,
    timestamp: Date.now()
  });

  const assistantIndex = messages.length;
  messages.push({
    role: "assistant",
    currentVersion: 0,
    versions: [{ content: "" }],
    timestamp: Date.now()
  });

  input.value = "";
  saveChats();
  sendChat(historyFromMessages(), assistantIndex, 0);
};

function historyFromMessages() {
  const chat = chats[currentChatId];
  const sys = chat.systemPrompt;

  const history = [];
  if (sys) history.push({ role: "system", content: sys });

  messages.forEach(m => {
    if (m.deleted) return;
    if (m.role === "assistant") {
      const v = m.versions[m.currentVersion];
      history.push({ role: "assistant", content: v.content });
    } else {
      history.push({ role: m.role, content: m.content });
    }
  });

  return history;
}

function sendChat(history, assistantIndex, versionIndex) {
  if (!wsReady) return;
  if (!MODEL) return;

  isStreaming = true;
  send.disabled = true;
  send.textContent = "…";
  stopBtn.disabled = false;

  ws.send(JSON.stringify({
    type: "chat",
    history,
    model: MODEL,
    assistantIndex,
    versionIndex
  }));

  renderMessages();
}

/* ============================================================
   REGENERATE (new version)
============================================================ */
function regenerateMessage(index) {
  const msg = messages[index];
  msg.versions.push({ content: "" });
  msg.currentVersion = msg.versions.length - 1;

  const history = historyFromMessages();
  sendChat(history, index, msg.currentVersion);
}

/* ============================================================
   CONTINUE GENERATION
============================================================ */
function continueMessage(index) {
  const msg = messages[index];
  const v = msg.versions[msg.currentVersion];

  const history = historyFromMessages();
  sendChat(history, index, msg.currentVersion);
}

/* ============================================================
   INPUT BEHAVIOR
============================================================ */
input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send.click();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
});

/* ============================================================
   SIDEBAR TOGGLE + SWIPE
============================================================ */
sidebarToggle.onclick = () => {
  if (window.innerWidth <= 768) {
    document.body.classList.toggle("sidebar-open");
  } else {
    document.body.classList.toggle("sidebar-collapsed");
  }
};

sidebarOverlay.onclick = () => {
  document.body.classList.remove("sidebar-open");
};

newChatBtn.onclick = () => {
  createNewChat();
  if (window.innerWidth <= 768) document.body.classList.remove("sidebar-open");
};

/* Swipe gestures */
let touchStartX = null;

document.addEventListener("touchstart", e => {
  if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
});

document.addEventListener("touchend", e => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;

  if (dx > 60 && touchStartX < 40) {
    document.body.classList.add("sidebar-open");
  } else if (dx < -60) {
    document.body.classList.remove("sidebar-open");
  }

  touchStartX = null;
});

/* ============================================================
   KEYBOARD SHORTCUTS
============================================================ */
window.addEventListener("keydown", e => {
  if (e.ctrlKey && e.key.toLowerCase() === "n") {
    e.preventDefault();
    createNewChat();
  }
  if (e.ctrlKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    input.focus();
  }
});

/* ============================================================
   INIT
============================================================ */
loadChats();
