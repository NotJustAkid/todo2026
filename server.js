const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { randomBytes, randomUUID, scrypt: scryptCallback, timingSafeEqual } = require("node:crypto");

const app = express();
const port = process.env.PORT || 3000;
const dataDirectory = path.join(__dirname, "data");
const dataFile = path.join(dataDirectory, "todos.json");
const usersFile = path.join(dataDirectory, "users.json");
const SESSION_COOKIE = "calendar_session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const scrypt = promisify(scryptCallback);

let todos = [];
let users = [];
const sessions = new Map();
let writeQueue = Promise.resolve();
let userWriteQueue = Promise.resolve();

app.use(express.json({ limit: "16kb" }));
app.use((request, response, next) => {
  const sessionId = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const session = sessionId && sessions.get(sessionId);
  if (session?.expiresAt > Date.now()) {
    request.user = users.find((user) => user.id === session.userId) || null;
  } else if (sessionId) {
    sessions.delete(sessionId);
  }
  next();
});
app.use("/data", (request, response) => response.sendStatus(404));
app.use(express.static(__dirname));

app.get("/api/auth/me", (request, response) => {
  response.json({ user: publicUser(request.user) });
});

app.post("/api/auth/register", async (request, response, next) => {
  const { username, password } = request.body || {};
  if (typeof username !== "string" || !/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
    return response.status(400).json({ error: "아이디는 영문, 숫자, _, -를 사용해 3~30자로 입력해 주세요." });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    return response.status(400).json({ error: "비밀번호는 8~200자로 입력해 주세요." });
  }
  const usernameKey = username.toLowerCase();
  if (users.some((user) => user.usernameKey === usernameKey)) {
    return response.status(409).json({ error: "이미 사용 중인 아이디입니다." });
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = (await scrypt(password, salt, 64)).toString("hex");
  if (users.some((user) => user.usernameKey === usernameKey)) {
    return response.status(409).json({ error: "이미 사용 중인 아이디입니다." });
  }
  const user = { id: randomUUID(), username, usernameKey, salt, passwordHash };
  users.push(user);
  try {
    await saveUsers();
    createSession(user, response);
    response.status(201).json({ user: publicUser(user) });
  } catch (error) {
    users = users.filter((item) => item.id !== user.id);
    next(error);
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  const { username, password } = request.body || {};
  if (typeof username !== "string" || typeof password !== "string") {
    return response.status(400).json({ error: "아이디와 비밀번호를 입력해 주세요." });
  }
  const user = users.find((item) => item.usernameKey === username.toLowerCase());
  if (!user) return response.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });

  try {
    const candidate = await scrypt(password, user.salt, 64);
    if (!timingSafeEqual(candidate, Buffer.from(user.passwordHash, "hex"))) {
      return response.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    createSession(user, response);
    response.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", requireAuth, (request, response) => {
  const sessionId = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (sessionId) sessions.delete(sessionId);
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  response.json({ ok: true });
});

app.get("/api/todos", requireAuth, (request, response) => {
  response.json(todos.filter((todo) => todo.ownerId === request.user.id));
});

app.post("/api/todos", requireAuth, async (request, response, next) => {
  const { date, text } = request.body || {};
  if (!isDate(date) || typeof text !== "string" || !text.trim() || text.trim().length > 200) {
    return response.status(400).json({ error: "날짜와 1~200자 할 일 내용이 필요합니다." });
  }

  const todo = {
    id: randomUUID(),
    ownerId: request.user.id,
    date,
    text: text.trim(),
    done: false,
    createdAt: Date.now(),
  };
  todos.push(todo);
  try {
    await saveTodos();
    response.status(201).json(todo);
  } catch (error) {
    todos = todos.filter((item) => item.id !== todo.id);
    next(error);
  }
});

app.patch("/api/todos/:id", requireAuth, async (request, response, next) => {
  const index = todos.findIndex((item) => item.id === request.params.id && item.ownerId === request.user.id);
  if (index === -1) return response.status(404).json({ error: "할 일을 찾을 수 없습니다." });

  const patch = request.body || {};
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((key) => !["text", "done"].includes(key))) {
    return response.status(400).json({ error: "수정할 내용이 올바르지 않습니다." });
  }
  if ("text" in patch && (typeof patch.text !== "string" || !patch.text.trim() || patch.text.trim().length > 200)) {
    return response.status(400).json({ error: "할 일 내용은 1~200자여야 합니다." });
  }
  if ("done" in patch && typeof patch.done !== "boolean") {
    return response.status(400).json({ error: "완료 상태가 올바르지 않습니다." });
  }

  const previous = todos[index];
  const updated = { ...previous, ...patch };
  if ("text" in patch) updated.text = patch.text.trim();
  todos[index] = updated;
  try {
    await saveTodos();
    response.json(updated);
  } catch (error) {
    todos[index] = previous;
    next(error);
  }
});

app.delete("/api/todos/:id", requireAuth, async (request, response, next) => {
  const index = todos.findIndex((item) => item.id === request.params.id && item.ownerId === request.user.id);
  if (index === -1) return response.status(404).json({ error: "할 일을 찾을 수 없습니다." });

  const [removed] = todos.splice(index, 1);
  try {
    await saveTodos();
    response.status(204).end();
  } catch (error) {
    todos.splice(index, 0, removed);
    next(error);
  }
});

app.use((error, request, response, next) => {
  console.error(error);
  if (response.headersSent) return next(error);
  response.status(500).json({ error: "서버에서 데이터를 저장하지 못했습니다." });
});

function isDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function requireAuth(request, response, next) {
  if (!request.user) return response.status(401).json({ error: "로그인이 필요합니다." });
  next();
}

function publicUser(user) {
  return user ? { id: user.id, username: user.username } : null;
}

function createSession(user, response) {
  const sessionId = randomBytes(32).toString("hex");
  sessions.set(sessionId, { userId: user.id, expiresAt: Date.now() + SESSION_MAX_AGE });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE / 1000}${secure}`);
}

async function saveTodos() {
  const data = JSON.stringify(todos, null, 2);
  const save = writeQueue.then(async () => {
    await fs.writeFile(`${dataFile}.tmp`, data);
    await fs.rename(`${dataFile}.tmp`, dataFile);
  });
  writeQueue = save.catch(() => {});
  await save;
}

async function saveUsers() {
  const data = JSON.stringify(users, null, 2);
  const save = userWriteQueue.then(async () => {
    await fs.writeFile(`${usersFile}.tmp`, data, { mode: 0o600 });
    await fs.rename(`${usersFile}.tmp`, usersFile);
  });
  userWriteQueue = save.catch(() => {});
  await save;
}

async function start() {
  await fs.mkdir(dataDirectory, { recursive: true });
  todos = await loadArray(dataFile);
  users = await loadArray(usersFile);

  app.listen(port, () => {
    console.log(`Calendar server listening on http://localhost:${port}`);
  });
}

async function loadArray(file) {
  try {
    const stored = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Array.isArray(stored)) throw new Error(`${path.basename(file)} must contain an array.`);
    return stored;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

start().catch((error) => {
  console.error("Could not start calendar server:", error);
  process.exitCode = 1;
});
