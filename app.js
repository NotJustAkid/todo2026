const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const viewRoot = document.querySelector("#view");
const dialog = document.querySelector("#editor-dialog");
const periodLabel = document.querySelector("#period-label");
const summary = document.querySelector("#summary");
const authScreen = document.querySelector("#auth-screen");
const authForm = document.querySelector("#auth-form");
const authError = document.querySelector("#auth-error");
const authSubmit = document.querySelector("#auth-submit");
const calendarUi = document.querySelector("#calendar-ui");
const accountBar = document.querySelector("#account-bar");

const state = {
  cursor: startOfDay(new Date()),
  view: "month",
  panelOpen: false,
  editingId: null,
};

let todos = [];
let focusAdd = false;
let currentUser = null;
let authMode = "login";

authForm.addEventListener("submit", submitAuth);
document.querySelector("#auth-toggle").addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  authError.hidden = true;
  authForm.reset();
  render();
});
document.querySelector("#logout-button").addEventListener("click", logout);

document.querySelector(".view-switch").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  state.view = button.dataset.view;
  state.editingId = null;
  render();
});

document.querySelector("#prev").addEventListener("click", () => shift(-1));
document.querySelector("#next").addEventListener("click", () => shift(1));
document.querySelector("#today").addEventListener("click", () => {
  state.cursor = startOfDay(new Date());
  state.panelOpen = false;
  state.editingId = null;
  render();
});

dialog.addEventListener("close", () => {
  if (state.view === "day") return;
  state.panelOpen = false;
  state.editingId = null;
  render();
});

initialize();

async function initialize() {
  try {
    const result = await apiRequest("/api/auth/me");
    currentUser = result.user;
    if (currentUser) todos = await apiRequest("/api/todos");
    render();
  } catch (error) {
    render();
    showError(error);
  }
}

async function submitAuth(event) {
  event.preventDefault();
  authError.hidden = true;
  authSubmit.disabled = true;
  const formData = new FormData(authForm);
  try {
    const result = await apiRequest(`/api/auth/${authMode}`, "POST", {
      username: formData.get("username"),
      password: formData.get("password"),
    });
    currentUser = result.user;
    todos = await apiRequest("/api/todos");
    authForm.reset();
    render();
  } catch (error) {
    authError.textContent = error.message;
    authError.hidden = false;
  } finally {
    authSubmit.disabled = false;
  }
}

async function logout() {
  try {
    await apiRequest("/api/auth/logout", "POST", {});
    currentUser = null;
    todos = [];
    state.panelOpen = false;
    state.editingId = null;
    authMode = "login";
    authError.hidden = true;
    authForm.reset();
    render();
  } catch (error) {
    showError(error);
  }
}

async function apiRequest(path, method = "GET", data) {
  const response = await fetch(path, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result.error || "서버 요청에 실패했습니다.");
  return result;
}

function showError(error) {
  window.alert(error.message);
}

function shift(direction) {
  state.panelOpen = false;
  state.editingId = null;
  if (state.view === "day") state.cursor = addDays(state.cursor, direction);
  else if (state.view === "week") state.cursor = addDays(state.cursor, direction * 7);
  else state.cursor = addMonths(state.cursor, direction);
  render();
}

function openPanel(date, editId = null) {
  state.cursor = startOfDay(date);
  state.panelOpen = true;
  state.editingId = editId;
  focusAdd = !editId;
  render();
}

function todosOn(date) {
  const key = toKey(date);
  return todos.filter((item) => item.date === key);
}

async function addTodo(dateKey, text) {
  const value = text.trim();
  if (!value) return false;
  try {
    todos.push(await apiRequest("/api/todos", "POST", { date: dateKey, text: value }));
    focusAdd = true;
    render();
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}

async function updateTodo(id, patch) {
  try {
    const updated = await apiRequest(`/api/todos/${encodeURIComponent(id)}`, "PATCH", patch);
    todos = todos.map((item) => (item.id === id ? updated : item));
  } catch (error) {
    showError(error);
  }
}

async function deleteTodo(id) {
  try {
    await apiRequest(`/api/todos/${encodeURIComponent(id)}`, "DELETE");
    todos = todos.filter((item) => item.id !== id);
    if (state.editingId === id) state.editingId = null;
    render();
  } catch (error) {
    showError(error);
  }
}

function render() {
  const authenticated = Boolean(currentUser);
  authScreen.hidden = authenticated;
  calendarUi.hidden = !authenticated;
  accountBar.hidden = !authenticated;
  if (!authenticated) {
    document.querySelector("#auth-title").textContent = authMode === "login" ? "로그인" : "회원가입";
    document.querySelector("#auth-description").textContent = authMode === "login"
      ? "로그인하면 내 할 일을 확인하고 관리할 수 있습니다."
      : "아이디와 비밀번호를 만들어 시작하세요. 비밀번호는 8자 이상이어야 합니다.";
    authSubmit.textContent = authMode === "login" ? "로그인" : "회원가입";
    document.querySelector("#auth-toggle").textContent = authMode === "login"
      ? "계정이 없으신가요? 회원가입"
      : "이미 계정이 있으신가요? 로그인";
    document.querySelector("#auth-password").autocomplete = authMode === "login" ? "current-password" : "new-password";
    return;
  }
  document.querySelector("#account-name").textContent = `${currentUser.username}님`;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.view === state.view));
  });

  const prev = document.querySelector("#prev");
  const next = document.querySelector("#next");
  const unit = state.view === "day" ? "일" : state.view === "week" ? "주" : "달";
  prev.setAttribute("aria-label", `이전 ${unit}`);
  next.setAttribute("aria-label", `다음 ${unit}`);
  periodLabel.textContent = formatPeriod();
  summary.textContent = formatSummary();

  if (state.view === "month") renderMonth();
  else if (state.view === "week") renderWeek();
  else renderDayPage();

  if (state.view !== "day" && state.panelOpen) {
    renderEditor(dialog, false);
    if (!dialog.open) dialog.showModal();
  } else if (dialog.open) {
    dialog.close();
  }

  if (focusAdd) {
    const input = document.querySelector(".add-form input");
    if (input) input.focus();
    focusAdd = false;
  } else if (state.editingId) {
    const input = document.querySelector(`[data-edit="${CSS.escape(state.editingId)}"]`);
    if (input && document.activeElement !== input) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }
}

function renderMonth() {
  const days = monthDays(state.cursor);
  viewRoot.replaceChildren(
    el("div", { class: "weekday-row" }, WEEKDAYS.map((name, index) => el("span", { class: weekdayClass(index), text: name }))),
    el("div", { class: "month-grid" }, days.map((date) => {
      const items = todosOn(date);
      const outside = date.getMonth() !== state.cursor.getMonth();
      const classes = ["cell"];
      if (outside) classes.push("outside");
      if (isToday(date)) classes.push("today");
      if (state.panelOpen && sameDay(date, state.cursor)) classes.push("selected");
      return el("div", { class: classes.join(" "), "data-count": items.length }, [
        el("button", {
          type: "button",
          class: `date-num ${weekdayClass(date.getDay())}`,
          text: String(date.getDate()),
          "aria-label": `${formatFullDate(date)} 할 일 열기`,
          onclick: () => openPanel(date),
        }),
        ...items.slice(0, 3).map((item) => el("button", {
          type: "button",
          class: `preview${item.done ? " done" : ""}`,
          text: item.text,
          onclick: () => openPanel(date, item.id),
        })),
        items.length > 3 ? el("p", { class: "more", text: `+${items.length - 3}` }) : null,
      ]);
    }))
  );
}

function renderWeek() {
  const days = weekDays(state.cursor);
  viewRoot.replaceChildren(
    el("div", { class: "week-scroll" }, [
      el("div", { class: "week-grid" }, days.map((date) => {
        const items = todosOn(date);
        const classes = ["week-col"];
        if (isToday(date)) classes.push("today");
        if (state.panelOpen && sameDay(date, state.cursor)) classes.push("selected");
        return el("section", { class: classes.join(" ") }, [
          el("button", { type: "button", class: "week-head", onclick: () => openPanel(date) }, [
            el("span", { class: weekdayClass(date.getDay()), text: WEEKDAYS[date.getDay()] }),
            el("strong", { class: weekdayClass(date.getDay()), text: String(date.getDate()) }),
          ]),
          el("div", { class: "week-list" }, items.map((item) => el("div", { class: `chip${item.done ? " done" : ""}` }, [
            el("input", {
              class: "check",
              type: "checkbox",
              checked: item.done,
              "aria-label": `${item.text} 완료`,
              onchange: () => updateTodo(item.id, { done: !item.done }).then(render),
            }),
            el("button", {
              type: "button",
              class: "text",
              text: item.text,
              onclick: () => openPanel(date, item.id),
            }),
          ]))),
        ]);
      })),
    ])
  );
}

function renderDayPage() {
  const wrap = el("div", { class: "day-wrap" });
  viewRoot.replaceChildren(wrap);
  renderEditor(wrap, true);
}

function renderEditor(container, embedded) {
  const date = state.cursor;
  const key = toKey(date);
  const items = todosOn(date);
  container.replaceChildren(
    el("div", { class: `editor${isToday(date) && embedded ? " today day-editor" : ""}` }, [
      el("div", { class: "editor-head" }, [
        el("div", {}, [
          el("p", { class: "editor-kicker", text: `${date.getFullYear()}년 ${WEEKDAYS[date.getDay()]}요일` }),
          el("h3", { text: `${date.getMonth() + 1}월 ${date.getDate()}일` }),
        ]),
        embedded ? null : el("button", {
          type: "button",
          class: "close-btn",
          "aria-label": "닫기",
          text: "×",
          onclick: () => dialog.close(),
        }),
      ]),
      items.length
        ? el("ul", { class: "todo-list" }, items.map((item) => renderTodoItem(item)))
        : el("p", { class: "empty", text: "이 날의 할 일이 없습니다." }),
      el("form", {
        class: "add-form",
        onsubmit: async (event) => {
          event.preventDefault();
          const input = event.target.elements.text;
          if (await addTodo(key, input.value)) input.value = "";
        },
      }, [
        el("input", {
          name: "text",
          type: "text",
          placeholder: "새 할 일",
          maxlength: "200",
          autocomplete: "off",
          "aria-label": "새 할 일",
          required: true,
        }),
        el("button", { type: "submit", text: "추가" }),
      ]),
    ])
  );
}

function renderTodoItem(item) {
  const body = state.editingId === item.id
    ? el("input", {
      class: "edit-input",
      type: "text",
      value: item.text,
      "data-edit": item.id,
      maxlength: "200",
      "aria-label": "할 일 수정",
      onkeydown: (event) => {
        if (event.key === "Escape") {
          event.target.dataset.committed = "1";
          state.editingId = null;
          render();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          commitEdit(item, event.target.value, event.target);
        }
      },
      onblur: (event) => {
        const input = event.target;
        const value = input.value;
        setTimeout(() => commitEdit(item, value, input), 0);
      },
    })
    : el("button", {
      type: "button",
      class: `todo-text${item.done ? " done" : ""}`,
      text: item.text,
      title: "클릭하여 수정",
      onclick: () => {
        state.editingId = item.id;
        render();
      },
    });

  return el("li", { class: "todo-item" }, [
    el("input", {
      class: "check",
      type: "checkbox",
      checked: item.done,
      "aria-label": `${item.text} 완료`,
      onchange: () => updateTodo(item.id, { done: !item.done }).then(render),
    }),
    body,
    el("button", {
      type: "button",
      class: "delete-btn",
      text: "삭제",
      onclick: () => deleteTodo(item.id),
    }),
  ]);
}

function commitEdit(item, value, input) {
  if (input?.dataset.committed === "1") return;
  if (input) input.dataset.committed = "1";
  const existing = todos.find((todo) => todo.id === item.id);
  if (!existing) return;
  const next = value.trim();
  const stillEditing = state.editingId === item.id;
  if (stillEditing) state.editingId = null;
  if (next && next !== existing.text) updateTodo(item.id, { text: next }).then(render);
  else if (stillEditing) render();
}

function formatSummary() {
  const keys = visibleDateKeys();
  const inView = todos.filter((item) => keys.includes(item.date));
  const open = inView.filter((item) => !item.done).length;
  if (!inView.length) return "할 일 없음";
  return `할 일 ${inView.length}개 · 남음 ${open}개`;
}

function visibleDateKeys() {
  if (state.view === "day") return [toKey(state.cursor)];
  if (state.view === "week") return weekDays(state.cursor).map(toKey);
  return monthDays(state.cursor)
    .filter((date) => date.getMonth() === state.cursor.getMonth())
    .map(toKey);
}

function formatPeriod() {
  const date = state.cursor;
  if (state.view === "day") return formatFullDate(date);
  if (state.view === "month") return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
  const start = startOfWeek(date);
  const end = addDays(start, 6);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) return `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}일 – ${end.getDate()}일`;
  if (sameYear) return `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}일 – ${end.getMonth() + 1}월 ${end.getDate()}일`;
  return `${formatFullDate(start)} – ${formatFullDate(end)}`;
}

function formatFullDate(date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`;
}

function monthDays(cursor) {
  const start = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function weekDays(cursor) {
  const start = startOfWeek(cursor);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function startOfWeek(date) {
  const day = startOfDay(date);
  return addDays(day, -day.getDay());
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function addMonths(date, amount) {
  const day = date.getDate();
  const next = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, last));
  return next;
}

function toKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function sameDay(a, b) {
  return toKey(a) === toKey(b);
}

function isToday(date) {
  return sameDay(date, new Date());
}

function weekdayClass(index) {
  if (index === 0) return "sun";
  if (index === 6) return "sat";
  return "";
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "checked") node.checked = Boolean(value);
    else if (key === "value") node.value = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}
