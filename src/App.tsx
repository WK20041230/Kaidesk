import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clapperboard,
  Download,
  Pencil,
  ListTodo,
  Pause,
  Play,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type FileSystemWritableFileStream = {
  write(data: string): Promise<void>;
  close(): Promise<void>;
};

type FileSystemFileHandle = {
  createWritable(): Promise<FileSystemWritableFileStream>;
};

type FileSystemDirectoryHandle = {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
};

type WindowWithFileSystemAccess = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

type SubjectId = "math" | "ds" | "co" | "os" | "cn" | "english" | "politics" | "review";
type ProgressArea = "math" | "fourOhEight";
type ActiveSection = "home" | "study" | "fun";
type TaskScope = "today" | "recent" | "course" | "life";

type SubjectConfig = {
  id: SubjectId;
  name: string;
  shortName: string;
  color: string;
};

type FocusSession = {
  id: string;
  date: string;
  startedAt: string;
  seconds: number;
  subject: SubjectId;
  note: string;
};

type ProgressEntry = {
  id: string;
  date: string;
  area: ProgressArea;
  content: string;
  note: string;
};

type FocusData = {
  sessions: FocusSession[];
  progress: ProgressEntry[];
  settings: {
    examDate: string;
  };
};

type TaskItem = {
  id: string;
  title: string;
  scope: TaskScope;
  dueDate: string;
  done: boolean;
  createdAt: string;
};

type EntertainmentItem = {
  id: string;
  title: string;
  kind: string;
  note: string;
  done: boolean;
  createdAt: string;
};

type KaiData = FocusData & {
  tasks: TaskItem[];
  entertainment: EntertainmentItem[];
};

type SyncConfig = {
  token: string;
  gistId: string;
  fileName: string;
};

type ActiveFocusDraft = {
  elapsedSeconds: number;
  lastSavedAt: string;
  note: string;
  running: boolean;
  subject: SubjectId;
};

const storageKey = "kaidesk-data-v1";
const syncConfigKey = "kaidesk-sync-config-v1";
const lastCloudSyncKey = "kaidesk-last-cloud-sync-v1";
const activeFocusKey = "kaidesk-active-focus-v1";
const legacyKeys = ["kai-focus-data-v4", "kai-focus-data-v3", "kai-focus-data-v2", "kai-focus-data-v1"];
const defaultExamDate = "2026-12-20";
const appBase = import.meta.env.BASE_URL;
const defaultSyncFileName = "kaidesk-data.json";
const taskScopeLabels: Record<TaskScope, string> = {
  today: "今日",
  recent: "近期",
  course: "课程",
  life: "生活",
};

function stripBase(pathname: string) {
  if (appBase !== "/" && pathname.startsWith(appBase)) {
    return pathname.slice(appBase.length - 1);
  }
  return pathname;
}

function sectionFromPath(): ActiveSection {
  const redirectedPath = new URLSearchParams(window.location.search).get("p");
  const currentPath = redirectedPath || stripBase(window.location.pathname);
  const path = currentPath.replace(/^\/+/, "").split("/")[0];
  if (path === "study" || path === "fun") return path;
  return "home";
}

const subjects: SubjectConfig[] = [
  { id: "math", name: "数学", shortName: "数", color: "#16635a" },
  { id: "ds", name: "408 数据结构", shortName: "DS", color: "#3867d6" },
  { id: "co", name: "408 计组", shortName: "组", color: "#8e5cf4" },
  { id: "os", name: "408 操作系统", shortName: "OS", color: "#d05c36" },
  { id: "cn", name: "408 计网", shortName: "网", color: "#0f8b8d" },
  { id: "english", name: "英语", shortName: "英", color: "#e5aa3c" },
  { id: "politics", name: "政治", shortName: "政", color: "#6f7b78" },
  { id: "review", name: "整理/复盘", shortName: "整", color: "#2f4858" },
];

const subjectById = Object.fromEntries(subjects.map((subject) => [subject.id, subject])) as Record<
  SubjectId,
  SubjectConfig
>;

const defaultData: KaiData = {
  sessions: [],
  progress: [],
  tasks: [],
  entertainment: [],
  settings: {
    examDate: defaultExamDate,
  },
};

const defaultSyncConfig: SyncConfig = {
  token: "",
  gistId: "",
  fileName: defaultSyncFileName,
};

const createId = () => crypto.randomUUID();

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeSession(session: Partial<FocusSession> & { minutes?: number }): FocusSession | null {
  if (!session.id || !session.date || !session.startedAt) return null;
  const subject = subjects.find((item) => item.id === session.subject)?.id ?? "math";
  const seconds = typeof session.seconds === "number" ? session.seconds : Math.round((session.minutes || 0) * 60);
  if (seconds <= 0) return null;
  return {
    id: session.id,
    date: session.date,
    startedAt: session.startedAt,
    seconds,
    subject,
    note: session.note || "",
  };
}

function normalizeProgress(entry: Partial<ProgressEntry>): ProgressEntry | null {
  if (!entry.id || !entry.date || !entry.area || !entry.content) return null;
  if (entry.area !== "math" && entry.area !== "fourOhEight") return null;
  return {
    id: entry.id,
    date: entry.date,
    area: entry.area,
    content: entry.content,
    note: entry.note || "",
  };
}

function normalizeTask(task: Partial<TaskItem>): TaskItem | null {
  if (!task.id || !task.title) return null;
  const scope: TaskScope = task.scope && task.scope in taskScopeLabels ? task.scope : "recent";
  return {
    id: task.id,
    title: task.title,
    scope,
    dueDate: task.dueDate || "",
    done: Boolean(task.done),
    createdAt: task.createdAt || new Date().toISOString(),
  };
}

function normalizeEntertainment(item: Partial<EntertainmentItem>): EntertainmentItem | null {
  if (!item.id || !item.title) return null;
  return {
    id: item.id,
    title: item.title,
    kind: item.kind || "电影",
    note: item.note || "",
    done: Boolean(item.done),
    createdAt: item.createdAt || new Date().toISOString(),
  };
}

function readStoredData() {
  for (const key of [storageKey, ...legacyKeys]) {
    const raw = localStorage.getItem(key);
    if (raw) return raw;
  }
  return null;
}

function normalizeKaiData(parsed: Partial<KaiData>): KaiData {
  return {
    sessions: Array.isArray(parsed.sessions)
      ? parsed.sessions.map(normalizeSession).filter((session): session is FocusSession => Boolean(session))
      : [],
    progress: Array.isArray(parsed.progress)
      ? parsed.progress.map(normalizeProgress).filter((entry): entry is ProgressEntry => Boolean(entry))
      : [],
    tasks: Array.isArray(parsed.tasks)
      ? parsed.tasks.map(normalizeTask).filter((task): task is TaskItem => Boolean(task))
      : [],
    entertainment: Array.isArray(parsed.entertainment)
      ? parsed.entertainment
          .map(normalizeEntertainment)
          .filter((item): item is EntertainmentItem => Boolean(item))
      : [],
    settings: {
      examDate: parsed.settings?.examDate || defaultExamDate,
    },
  };
}

function loadData(): KaiData {
  const raw = readStoredData();
  if (!raw) return defaultData;
  try {
    const parsed = JSON.parse(raw) as Partial<KaiData>;
    return normalizeKaiData(parsed);
  } catch {
    return defaultData;
  }
}

function saveData(data: KaiData) {
  localStorage.setItem(storageKey, JSON.stringify(data));
}

function loadSyncConfig(): SyncConfig {
  const raw = localStorage.getItem(syncConfigKey);
  if (!raw) return defaultSyncConfig;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    return {
      token: parsed.token || "",
      gistId: parsed.gistId || "",
      fileName: parsed.fileName || defaultSyncFileName,
    };
  } catch {
    return defaultSyncConfig;
  }
}

function saveSyncConfig(config: SyncConfig) {
  localStorage.setItem(syncConfigKey, JSON.stringify(config));
}

function loadActiveFocusDraft(): ActiveFocusDraft | null {
  const raw = localStorage.getItem(activeFocusKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveFocusDraft>;
    const subject = subjects.find((item) => item.id === parsed.subject)?.id ?? "math";
    const elapsedSeconds = Math.max(0, Math.floor(Number(parsed.elapsedSeconds) || 0));
    const lastSavedAt = parsed.lastSavedAt || new Date().toISOString();
    const catchUpSeconds = parsed.running
      ? Math.max(0, Math.floor((Date.now() - new Date(lastSavedAt).getTime()) / 1000))
      : 0;
    return {
      elapsedSeconds: elapsedSeconds + catchUpSeconds,
      lastSavedAt: new Date().toISOString(),
      note: parsed.note || "",
      running: Boolean(parsed.running),
      subject,
    };
  } catch {
    return null;
  }
}

function saveActiveFocusDraft(draft: ActiveFocusDraft) {
  localStorage.setItem(activeFocusKey, JSON.stringify(draft));
}

function clearActiveFocusDraft() {
  localStorage.removeItem(activeFocusKey);
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

function formatClock(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(date);
}

function getMonthDays(cursor: Date) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days: Date[] = [];
  for (let day = 1; day <= last.getDate(); day += 1) days.push(new Date(year, month, day));
  return { days, leading: (first.getDay() + 6) % 7 };
}

function secondsBySubject(sessions: FocusSession[]) {
  return sessions.reduce<Record<SubjectId, number>>(
    (acc, session) => {
      acc[session.subject] += session.seconds;
      return acc;
    },
    Object.fromEntries(subjects.map((subject) => [subject.id, 0])) as Record<SubjectId, number>,
  );
}

function fourOhEightSeconds(totals: Record<SubjectId, number>) {
  return totals.ds + totals.co + totals.os + totals.cn;
}

function getLatestProgress(entries: ProgressEntry[], area: ProgressArea, date?: string) {
  return entries.find((entry) => entry.area === area && (!date || entry.date === date));
}

function isOverdueTask(task: TaskItem, today: string) {
  return !task.done && Boolean(task.dueDate) && task.dueDate < today;
}

function buildCodexSummary(data: KaiData) {
  const today = todayKey();
  const currentMonth = today.slice(0, 7);
  const todaySessions = data.sessions.filter((session) => session.date === today);
  const monthSessions = data.sessions.filter((session) => session.date.startsWith(currentMonth));
  const todayTotals = secondsBySubject(todaySessions);
  const monthTotals = secondsBySubject(monthSessions);
  const latestMath = getLatestProgress(data.progress, "math");
  const latest408 = getLatestProgress(data.progress, "fourOhEight");
  const monthTotal = monthSessions.reduce((sum, session) => sum + session.seconds, 0);
  const openTasks = data.tasks.filter((task) => !task.done);
  const overdueTasks = openTasks.filter((task) => isOverdueTask(task, today));
  const todayTasks = openTasks.filter((task) => !isOverdueTask(task, today) && (task.scope === "today" || task.dueDate === today));
  const upcomingTasks = openTasks.filter(
    (task) => !isOverdueTask(task, today) && task.scope !== "today" && task.dueDate !== today,
  );
  const doneTasks = data.tasks.filter((task) => task.done);
  const openEntertainment = data.entertainment.filter((item) => !item.done);

  const subjectLines = subjects.map((subject) => `- ${subject.name}: ${formatDuration(monthTotals[subject.id])}`);
  const progressLines = data.progress.slice(0, 12).map((entry) => {
    const area = entry.area === "math" ? "Math" : "408";
    const note = entry.note ? ` - ${entry.note}` : "";
    return `- ${entry.date} ${area}: ${entry.content}${note}`;
  });
  const openTaskLines = openTasks.slice(0, 20).map((task) => {
    const due = task.dueDate ? ` due ${task.dueDate}` : "";
    return `- [${taskScopeLabels[task.scope]}] ${task.title}${due}`;
  });

  return [
    "# 11408 Study Summary",
    "",
    `Generated: ${new Date().toLocaleString("zh-CN")}`,
    "",
    "## Today",
    "",
    `- Math: ${formatDuration(todayTotals.math)}`,
    `- 408: ${formatDuration(fourOhEightSeconds(todayTotals))}`,
    `- English: ${formatDuration(todayTotals.english)}`,
    `- Politics: ${formatDuration(todayTotals.politics)}`,
    "",
    "## This Month By Subject",
    "",
    `- Total: ${formatDuration(monthTotal)}`,
    ...subjectLines,
    "",
    "## Latest Progress",
    "",
    `- Math: ${latestMath ? `${latestMath.content} (${latestMath.date})` : "not recorded"}`,
    `- 408: ${latest408 ? `${latest408.content} (${latest408.date})` : "not recorded"}`,
    "",
    "## Recent Progress Entries",
    "",
    ...(progressLines.length ? progressLines : ["- none"]),
    "",
    "## Recent Sessions",
    "",
    ...data.sessions.slice(0, 12).map((session) => {
      const note = session.note ? ` - ${session.note}` : "";
      return `- ${session.date} ${subjectById[session.subject].name}: ${formatDuration(session.seconds)}${note}`;
    }),
    "",
    "## Open Tasks",
    "",
    ...(openTaskLines.length ? openTaskLines : ["- none"]),
    "",
    "## Task Health",
    "",
    `- Open tasks: ${openTasks.length}`,
    `- Overdue tasks: ${overdueTasks.length}`,
    `- Today's tasks: ${todayTasks.length}`,
    `- Upcoming tasks: ${upcomingTasks.length}`,
    `- Recently done tasks: ${doneTasks.slice(0, 8).map((task) => task.title).join(" / ") || "none"}`,
    "",
    "## Overdue Tasks",
    "",
    ...(overdueTasks.length
      ? overdueTasks.slice(0, 12).map((task) => `- [${taskScopeLabels[task.scope]}] ${task.title} due ${task.dueDate}`)
      : ["- none"]),
    "",
    "## Entertainment Backlog",
    "",
    `- Open entertainment items: ${openEntertainment.length}`,
    ...(openEntertainment.length
      ? openEntertainment.slice(0, 12).map((item) => {
          const note = item.note ? ` - ${item.note}` : "";
          return `- [${item.kind}] ${item.title}${note}`;
        })
      : ["- none"]),
    "",
    "## Prompt",
    "",
    "评价最近学习：请基于这些学习记录，评价我的备考节奏，指出数学、408、英语的风险，并给出接下来一周的现实建议。",
  ].join("\n");
}

export function App() {
  const [data, setData] = useState<KaiData>(() => loadData());
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(() => loadSyncConfig());
  const [activeSection, setActiveSection] = useState<ActiveSection>(() => sectionFromPath());
  const [restoredFocusDraft] = useState(() => loadActiveFocusDraft());
  const [running, setRunning] = useState(() => restoredFocusDraft?.running ?? false);
  const [elapsedSeconds, setElapsedSeconds] = useState(() => restoredFocusDraft?.elapsedSeconds ?? 0);
  const [selectedSubject, setSelectedSubject] = useState<SubjectId>(() => restoredFocusDraft?.subject ?? "math");
  const [sessionNote, setSessionNote] = useState(() => restoredFocusDraft?.note ?? "");
  const [focusRestoreMessage, setFocusRestoreMessage] = useState(() =>
    restoredFocusDraft ? "已恢复上次未记录的专注。" : "",
  );
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [progressDraft, setProgressDraft] = useState({ math: "", fourOhEight: "" });
  const [taskDraft, setTaskDraft] = useState({ title: "", scope: "today" as TaskScope, dueDate: "" });
  const [funDraft, setFunDraft] = useState({ title: "", kind: "电影", note: "" });
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskEditDraft, setTaskEditDraft] = useState({ title: "", scope: "today" as TaskScope, dueDate: "" });
  const [editingFunId, setEditingFunId] = useState<string | null>(null);
  const [funEditDraft, setFunEditDraft] = useState({ title: "", kind: "", note: "" });
  const [syncMessage, setSyncMessage] = useState("");
  const [cloudMessage, setCloudMessage] = useState("");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [lastCloudSync, setLastCloudSync] = useState(() => localStorage.getItem(lastCloudSyncKey) || "");
  const fileInput = useRef<HTMLInputElement>(null);
  const hasLocalChangesRef = useRef(false);
  const cloudBusyRef = useRef(false);

  const markCloudSynced = () => {
    const value = new Date().toLocaleString("zh-CN");
    setLastCloudSync(value);
    localStorage.setItem(lastCloudSyncKey, value);
  };

  const markLocalChanges = (dirty: boolean) => {
    hasLocalChangesRef.current = dirty;
    setHasLocalChanges(dirty);
  };

  const persist = (next: KaiData, options: { dirty?: boolean } = {}) => {
    setData(next);
    saveData(next);
    if (options.dirty !== false) markLocalChanges(true);
  };

  const persistSyncConfig = (next: SyncConfig) => {
    setSyncConfig(next);
    saveSyncConfig(next);
  };

  useEffect(() => {
    cloudBusyRef.current = cloudBusy;
  }, [cloudBusy]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (elapsedSeconds <= 0 && !sessionNote.trim()) {
      clearActiveFocusDraft();
      return;
    }
    saveActiveFocusDraft({
      elapsedSeconds,
      lastSavedAt: new Date().toISOString(),
      note: sessionNote,
      running,
      subject: selectedSubject,
    });
  }, [elapsedSeconds, running, selectedSubject, sessionNote]);

  useEffect(() => {
    const onPopState = () => setActiveSection(sectionFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const redirectedPath = new URLSearchParams(window.location.search).get("p");
    if (redirectedPath) {
      window.history.replaceState(null, "", `${appBase}${redirectedPath.replace(/^\/+/, "")}`);
    }
  }, []);

  const today = todayKey();
  const openTasks = data.tasks.filter((task) => !task.done);
  const overdueTasks = openTasks.filter((task) => isOverdueTask(task, today));
  const todayTasks = openTasks.filter(
    (task) => !isOverdueTask(task, today) && (task.scope === "today" || task.dueDate === today),
  );
  const upcomingTasks = openTasks
    .filter((task) => !isOverdueTask(task, today) && task.scope !== "today" && task.dueDate !== today)
    .slice(0, 8);
  const recentDoneTasks = data.tasks.filter((task) => task.done).slice(0, 4);
  const openEntertainment = data.entertainment.filter((item) => !item.done);
  const todaySessions = useMemo(() => data.sessions.filter((session) => session.date === today), [data.sessions, today]);
  const todaySubjectSeconds = useMemo(() => {
    const totals = secondsBySubject(todaySessions);
    totals[selectedSubject] += elapsedSeconds;
    return totals;
  }, [elapsedSeconds, selectedSubject, todaySessions]);
  const todayTotalSeconds = Object.values(todaySubjectSeconds).reduce((sum, seconds) => sum + seconds, 0);

  const monthPrefix = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}`;
  const monthSessions = data.sessions.filter((session) => session.date.startsWith(monthPrefix));
  const monthSubjectSeconds = secondsBySubject(monthSessions);
  const monthTotalSeconds = monthSessions.reduce((sum, session) => sum + session.seconds, 0);

  const selectedDaySessions = data.sessions.filter((session) => session.date === selectedDate);
  const selectedDayTotals = secondsBySubject(selectedDaySessions);
  const selectedDayProgress = data.progress.filter((entry) => entry.date === selectedDate);

  const selectedSubjectConfig = subjectById[selectedSubject];
  const examTime = new Date(`${data.settings.examDate}T00:00:00`);
  const diffDays = Math.max(0, Math.ceil((examTime.getTime() - Date.now()) / 86400000));
  const monthGrid = getMonthDays(monthCursor);
  const totalsByDate = useMemo(() => {
    return data.sessions.reduce<Record<string, number>>((acc, session) => {
      acc[session.date] = (acc[session.date] || 0) + session.seconds;
      return acc;
    }, {});
  }, [data.sessions]);

  const recentSessions = data.sessions.slice(0, 8);
  const latestMath = getLatestProgress(data.progress, "math");
  const latest408 = getLatestProgress(data.progress, "fourOhEight");

  const saveSession = () => {
    if (elapsedSeconds <= 0) return;
    persist({
      ...data,
      sessions: [
        {
          id: createId(),
          date: today,
          startedAt: new Date().toISOString(),
          seconds: elapsedSeconds,
          subject: selectedSubject,
          note: sessionNote.trim(),
        },
        ...data.sessions,
      ],
    });
    setRunning(false);
    setElapsedSeconds(0);
    setSessionNote("");
    setFocusRestoreMessage("");
    clearActiveFocusDraft();
    setSelectedDate(today);
  };

  const saveProgress = (area: ProgressArea) => {
    const content = progressDraft[area].trim();
    if (!content) return;
    persist({
      ...data,
      progress: [
        {
          id: createId(),
          date: today,
          area,
          content,
          note: "",
        },
        ...data.progress,
      ],
    });
    setProgressDraft({ ...progressDraft, [area]: "" });
    setSelectedDate(today);
  };

  const addTask = () => {
    const title = taskDraft.title.trim();
    if (!title) return;
    persist({
      ...data,
      tasks: [
        {
          id: createId(),
          title,
          scope: taskDraft.scope,
          dueDate: taskDraft.dueDate,
          done: false,
          createdAt: new Date().toISOString(),
        },
        ...data.tasks,
      ],
    });
    setTaskDraft({ title: "", scope: taskDraft.scope, dueDate: "" });
  };

  const toggleTask = (id: string) => {
    persist({
      ...data,
      tasks: data.tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task)),
    });
  };

  const startEditTask = (task: TaskItem) => {
    setEditingTaskId(task.id);
    setTaskEditDraft({ title: task.title, scope: task.scope, dueDate: task.dueDate });
  };

  const saveTaskEdit = () => {
    const title = taskEditDraft.title.trim();
    if (!editingTaskId || !title) return;
    persist({
      ...data,
      tasks: data.tasks.map((task) =>
        task.id === editingTaskId
          ? { ...task, title, scope: taskEditDraft.scope, dueDate: taskEditDraft.dueDate }
          : task,
      ),
    });
    setEditingTaskId(null);
  };

  const deleteTask = (id: string) => {
    persist({
      ...data,
      tasks: data.tasks.filter((task) => task.id !== id),
    });
    if (editingTaskId === id) setEditingTaskId(null);
  };

  const addEntertainment = () => {
    const title = funDraft.title.trim();
    if (!title) return;
    persist({
      ...data,
      entertainment: [
        {
          id: createId(),
          title,
          kind: funDraft.kind.trim() || "电影",
          note: funDraft.note.trim(),
          done: false,
          createdAt: new Date().toISOString(),
        },
        ...data.entertainment,
      ],
    });
    setFunDraft({ title: "", kind: funDraft.kind, note: "" });
  };

  const toggleEntertainment = (id: string) => {
    persist({
      ...data,
      entertainment: data.entertainment.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    });
  };

  const startEditEntertainment = (item: EntertainmentItem) => {
    setEditingFunId(item.id);
    setFunEditDraft({ title: item.title, kind: item.kind, note: item.note });
  };

  const saveEntertainmentEdit = () => {
    const title = funEditDraft.title.trim();
    if (!editingFunId || !title) return;
    persist({
      ...data,
      entertainment: data.entertainment.map((item) =>
        item.id === editingFunId
          ? { ...item, title, kind: funEditDraft.kind.trim() || "电影", note: funEditDraft.note.trim() }
          : item,
      ),
    });
    setEditingFunId(null);
  };

  const deleteEntertainment = (id: string) => {
    persist({
      ...data,
      entertainment: data.entertainment.filter((item) => item.id !== id),
    });
    if (editingFunId === id) setEditingFunId(null);
  };

  const deleteSession = (id: string) => {
    persist({
      ...data,
      sessions: data.sessions.filter((session) => session.id !== id),
    });
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `11408-focus-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = JSON.parse(String(reader.result)) as Partial<KaiData>;
        persist(normalizeKaiData(next));
      } catch {
        alert("无法导入这个 JSON 文件。");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const writeCodexFiles = async (root: FileSystemDirectoryHandle, currentData: KaiData) => {
    const dataDir = await root.getDirectoryHandle("study-data", { create: true });
    const jsonFile = await dataDir.getFileHandle("records.json", { create: true });
    const jsonWriter = await jsonFile.createWritable();
    await jsonWriter.write(JSON.stringify(currentData, null, 2));
    await jsonWriter.close();

    const summaryFile = await dataDir.getFileHandle("summary.md", { create: true });
    const summaryWriter = await summaryFile.createWritable();
    await summaryWriter.write(buildCodexSummary(currentData));
    await summaryWriter.close();
  };

  const ensureProjectRoot = async (root: FileSystemDirectoryHandle) => {
    try {
      await root.getFileHandle("package.json");
      return true;
    } catch {
      return false;
    }
  };

  const syncForCodex = async () => {
    const picker = (window as WindowWithFileSystemAccess).showDirectoryPicker;
    if (!picker) {
      setSyncMessage("当前浏览器不支持直接写入文件夹。请使用导出按钮保存 JSON，再放到项目目录里。");
      return;
    }

    try {
      const root = await picker();
      if (!(await ensureProjectRoot(root))) {
        setSyncMessage("请选择项目根目录：C:\\Users\\Wu Kai\\Documents\\Codex\\Projects\\11408-study-tool。");
        return;
      }
      await writeCodexFiles(root, data);
      setSyncMessage("已更新 study-data/records.json 和 study-data/summary.md。现在可以在 Codex 里说：评价最近学习。");
    } catch {
      setSyncMessage("同步已取消或失败。");
    }
  };

  const getCloudHeaders = () => {
    const token = syncConfig.token.trim();
    if (!token) throw new Error("请先填写 GitHub Token。");
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  };

  const cloudFileName = () => syncConfig.fileName.trim() || defaultSyncFileName;

  const createCloudGist = async () => {
    setCloudBusy(true);
    setCloudMessage("");
    try {
      const fileName = cloudFileName();
      const response = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: getCloudHeaders(),
        body: JSON.stringify({
          description: "KaiDesk sync data",
          public: false,
          files: {
            [fileName]: {
              content: JSON.stringify(data, null, 2),
            },
          },
        }),
      });
      if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
      const gist = (await response.json()) as { id: string };
      persistSyncConfig({ ...syncConfig, gistId: gist.id, fileName });
      markLocalChanges(false);
      markCloudSynced();
      setCloudMessage(`已创建私密 Gist：${gist.id}，当前数据已上传。`);
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "创建云端数据失败。");
    } finally {
      setCloudBusy(false);
    }
  };

  const uploadToCloud = async () => {
    const gistId = syncConfig.gistId.trim();
    if (!gistId) {
      setCloudMessage("请先填写 Gist ID，或用同步完成创建云端数据。");
      return;
    }
    setCloudBusy(true);
    setCloudMessage("");
    try {
      const fileName = cloudFileName();
      const response = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: "PATCH",
        headers: getCloudHeaders(),
        body: JSON.stringify({
          files: {
            [fileName]: {
              content: JSON.stringify(data, null, 2),
            },
          },
        }),
      });
      if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
      persistSyncConfig({ ...syncConfig, gistId, fileName });
      markLocalChanges(false);
      markCloudSynced();
      setCloudMessage(`已同步到云端：${new Date().toLocaleString("zh-CN")}`);
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "同步到云端失败。");
    } finally {
      setCloudBusy(false);
    }
  };

  const pullFromCloud = async (mode: "manual" | "auto" = "manual") => {
    const gistId = syncConfig.gistId.trim();
    if (!gistId) {
      if (mode === "manual") setCloudMessage("请先填写 Gist ID。");
      return;
    }
    if (!syncConfig.token.trim()) {
      if (mode === "manual") setCloudMessage("请先填写 GitHub Token。");
      return;
    }
    if (mode === "auto" && hasLocalChangesRef.current) {
      setCloudMessage("本地有未上传修改，已暂停自动拉取。先点“同步完成”上传。");
      return;
    }
    if (cloudBusyRef.current) return;
    setCloudBusy(true);
    if (mode === "manual") setCloudMessage("");
    try {
      const response = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: getCloudHeaders(),
      });
      if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
      const gist = (await response.json()) as { files?: Record<string, { content?: string }> };
      const fileName = cloudFileName();
      const content = gist.files?.[fileName]?.content;
      if (!content) throw new Error(`云端没有找到 ${fileName}。`);
      const next = normalizeKaiData(JSON.parse(content) as Partial<KaiData>);
      persist(next, { dirty: false });
      markLocalChanges(false);
      persistSyncConfig({ ...syncConfig, gistId, fileName });
      markCloudSynced();
      setCloudMessage(
        mode === "auto"
          ? `已自动拉取云端数据：${new Date().toLocaleString("zh-CN")}`
          : `已从云端拉取：${new Date().toLocaleString("zh-CN")}`,
      );
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "从云端拉取失败。");
    } finally {
      setCloudBusy(false);
    }
  };

  const completeCloudSync = async () => {
    if (!syncConfig.token.trim()) {
      setCloudMessage("请先在高级设置里填写 GitHub Token。");
      return;
    }
    if (!syncConfig.gistId.trim()) {
      await createCloudGist();
      return;
    }
    await uploadToCloud();
  };

  useEffect(() => {
    if (!syncConfig.token.trim() || !syncConfig.gistId.trim()) return;

    const autoPull = () => {
      if (document.visibilityState === "visible") {
        void pullFromCloud("auto");
      }
    };

    autoPull();
    document.addEventListener("visibilitychange", autoPull);
    window.addEventListener("pageshow", autoPull);
    return () => {
      document.removeEventListener("visibilitychange", autoPull);
      window.removeEventListener("pageshow", autoPull);
    };
  }, [syncConfig.token, syncConfig.gistId, syncConfig.fileName]);

  const resetSession = () => {
    setRunning(false);
    setElapsedSeconds(0);
    setSessionNote("");
    setFocusRestoreMessage("");
    clearActiveFocusDraft();
  };

  const moveMonth = (step: number) => {
    setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + step, 1));
  };

  const openSection = (section: ActiveSection) => {
    const path = section === "home" ? appBase : `${appBase}${section}`;
    window.history.pushState(null, "", path);
    setActiveSection(section);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const sectionHref = (section: ActiveSection) => (section === "home" ? appBase : `${appBase}${section}`);

  const renderCloudSyncSummary = (compact = false) => (
    <>
      <div className={`sync-status ${compact ? "compact-status" : ""}`}>
        <strong>{hasLocalChanges ? "本地有未上传修改" : syncConfig.gistId ? "已连接云端" : "尚未连接云端"}</strong>
        <span>
          {lastCloudSync
            ? `上次同步：${lastCloudSync}`
            : syncConfig.gistId
              ? "打开页面或回到前台时会自动拉取"
              : "第一次点击同步完成会创建私密 Gist"}
        </span>
      </div>
      <button className="primary-button cloud-sync-button" onClick={completeCloudSync} disabled={cloudBusy}>
        <Upload size={17} />
        {cloudBusy ? "同步中" : "同步完成"}
      </button>
    </>
  );

  const renderTaskItem = (task: TaskItem, meta: string) => {
    const isEditing = editingTaskId === task.id;
    return (
      <article className={`task-item ${task.done ? "done" : ""}`} key={task.id}>
        {isEditing ? (
          <div className="inline-editor">
            <input
              value={taskEditDraft.title}
              onChange={(event) => setTaskEditDraft({ ...taskEditDraft, title: event.target.value })}
              placeholder="任务标题"
            />
            <select
              value={taskEditDraft.scope}
              onChange={(event) => setTaskEditDraft({ ...taskEditDraft, scope: event.target.value as TaskScope })}
            >
              {Object.entries(taskScopeLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={taskEditDraft.dueDate}
              onChange={(event) => setTaskEditDraft({ ...taskEditDraft, dueDate: event.target.value })}
            />
            <div className="inline-actions">
              <button className="secondary-button" onClick={saveTaskEdit}>
                <Save size={16} />
                保存
              </button>
              <button className="icon-button" onClick={() => setEditingTaskId(null)} title="取消">
                <X size={16} />
              </button>
            </div>
          </div>
        ) : (
          <>
            <button className="task-check" onClick={() => toggleTask(task.id)} title={task.done ? "标记未完成" : "完成"}>
              <CheckCircle2 size={18} />
            </button>
            <div className="item-main">
              <strong>{task.title}</strong>
              <small>{meta}</small>
            </div>
            <div className="item-actions">
              <button className="icon-button" onClick={() => startEditTask(task)} title="编辑任务">
                <Pencil size={16} />
              </button>
              <button className="icon-button danger" onClick={() => deleteTask(task.id)} title="删除任务">
                <Trash2 size={16} />
              </button>
            </div>
          </>
        )}
      </article>
    );
  };

  const renderEntertainmentItem = (item: EntertainmentItem) => {
    const isEditing = editingFunId === item.id;
    return (
      <article className={`fun-item ${item.done ? "done" : ""}`} key={item.id}>
        {isEditing ? (
          <div className="inline-editor">
            <input
              value={funEditDraft.title}
              onChange={(event) => setFunEditDraft({ ...funEditDraft, title: event.target.value })}
              placeholder="标题"
            />
            <input
              value={funEditDraft.kind}
              onChange={(event) => setFunEditDraft({ ...funEditDraft, kind: event.target.value })}
              placeholder="类型"
            />
            <textarea
              value={funEditDraft.note}
              onChange={(event) => setFunEditDraft({ ...funEditDraft, note: event.target.value })}
              placeholder="备注"
            />
            <div className="inline-actions">
              <button className="secondary-button" onClick={saveEntertainmentEdit}>
                <Save size={16} />
                保存
              </button>
              <button className="icon-button" onClick={() => setEditingFunId(null)} title="取消">
                <X size={16} />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="item-main">
              <strong>{item.title}</strong>
              <span>{item.kind}</span>
              {item.note && <p>{item.note}</p>}
              <small>{item.done ? "已看 / 已玩" : "未完成"}</small>
            </div>
            <div className="item-actions">
              <button className="icon-button" onClick={() => toggleEntertainment(item.id)} title="切换完成状态">
                <CheckCircle2 size={16} />
              </button>
              <button className="icon-button" onClick={() => startEditEntertainment(item)} title="编辑">
                <Pencil size={16} />
              </button>
              <button className="icon-button danger" onClick={() => deleteEntertainment(item.id)} title="删除">
                <Trash2 size={16} />
              </button>
            </div>
          </>
        )}
      </article>
    );
  };

  return (
    <main className={`focus-shell ${activeSection === "home" ? "home-page" : "feature-page"}`}>
      {activeSection !== "home" && (
        <div className="page-topbar">
          <a
            href={sectionHref("home")}
            onClick={(event) => {
              event.preventDefault();
              openSection("home");
            }}
          >
            <ArrowLeft size={19} />
            返回首页
          </a>
          <span>KaiDesk / {activeSection === "study" ? "考研专区" : "娱乐清单"}</span>
        </div>
      )}
      <header className="hero">
        {activeSection === "home" && (
          <>
            <div>
              <p className="eyebrow">KaiDesk</p>
              <h1>首页</h1>
              <p className="hero-copy">今天要做的事、近期待办、课程和生活提醒都先放这里。考研和娱乐清单作为独立页面进入。</p>
            </div>
            <section className="countdown-card">
              <span>未完成待办</span>
              <strong>{openTasks.length}</strong>
              <span>项</span>
            </section>
          </>
        )}
        {activeSection === "study" && (
          <>
            <div>
              <p className="eyebrow">11408 Study Tool</p>
              <h1>考研专注与进度仪表盘</h1>
              <p className="hero-copy">只记录真实投入和进度，不设置每日死标准；评价时综合看时间、科目分布和章节推进。</p>
            </div>
            <section className="countdown-card">
              <span>距离考研还有</span>
              <strong>{diffDays}</strong>
              <span>天</span>
              <input
                type="date"
                value={data.settings.examDate}
                onChange={(event) => persist({ ...data, settings: { ...data.settings, examDate: event.target.value } })}
              />
            </section>
          </>
        )}
        {activeSection === "fun" && (
          <>
            <div>
              <p className="eyebrow">Rest List</p>
              <h1>娱乐清单</h1>
              <p className="hero-copy">把想看的电影、剧、纪录片、游戏和书先存起来，休息时直接从这里挑。</p>
            </div>
            <section className="countdown-card">
              <span>待看 / 待玩</span>
              <strong>{openEntertainment.length}</strong>
              <span>项</span>
            </section>
          </>
        )}
      </header>

      {activeSection === "home" && (
        <>
        <section className="module-grid">
          <a
            className="module-card"
            href={sectionHref("study")}
            onClick={(event) => {
              event.preventDefault();
              openSection("study");
            }}
          >
            <BookOpen size={22} />
            <span>考研专区</span>
            <strong>专注计时、进度记录、日历统计</strong>
          </a>
          <a
            className="module-card"
            href={sectionHref("fun")}
            onClick={(event) => {
              event.preventDefault();
              openSection("fun");
            }}
          >
            <Clapperboard size={22} />
            <span>娱乐清单</span>
            <strong>电影、剧、游戏、书，休息时再看</strong>
          </a>
        </section>

        <section className="home-grid">
          <section className="subject-panel task-panel">
            <div className="section-head">
              <div>
                <p>今日任务</p>
                <h2>今天和近期先放这里</h2>
              </div>
              <ListTodo size={19} />
            </div>
            <div className="task-composer">
              <input
                value={taskDraft.title}
                onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addTask();
                }}
                placeholder="例如：完成数据库作业、看数据结构绪论、取快递"
              />
              <select
                value={taskDraft.scope}
                onChange={(event) => setTaskDraft({ ...taskDraft, scope: event.target.value as TaskScope })}
              >
                {Object.entries(taskScopeLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={taskDraft.dueDate}
                onChange={(event) => setTaskDraft({ ...taskDraft, dueDate: event.target.value })}
              />
              <button className="primary-button" onClick={addTask}>
                <Save size={17} />
                添加
              </button>
            </div>
            <div className="task-columns">
              <div>
                <h3>逾期</h3>
                <div className="task-list">
                  {overdueTasks.length === 0 && <p className="empty">没有逾期任务。</p>}
                  {overdueTasks.map((task) =>
                    renderTaskItem(task, `${task.dueDate} · ${taskScopeLabels[task.scope]}`),
                  )}
                </div>
              </div>
              <div>
                <h3>今天</h3>
                <div className="task-list">
                  {todayTasks.length === 0 && <p className="empty">今天还没有待办。</p>}
                  {todayTasks.map((task) => renderTaskItem(task, task.dueDate || taskScopeLabels[task.scope]))}
                </div>
              </div>
              <div>
                <h3>近期</h3>
                <div className="task-list">
                  {upcomingTasks.length === 0 && <p className="empty">近期任务会显示在这里。</p>}
                  {upcomingTasks.map((task) => renderTaskItem(task, task.dueDate || taskScopeLabels[task.scope]))}
                </div>
              </div>
            </div>
          </section>

          <aside className="home-side">
            <section className="history-panel">
              <div className="section-head compact">
                <h2>今日概览</h2>
                <Square size={16} />
              </div>
              <div className="overview-list">
                <div>
                  <span>今日专注</span>
                  <strong>{formatDuration(todayTotalSeconds)}</strong>
                </div>
                <div>
                  <span>今日 408</span>
                  <strong>{formatDuration(fourOhEightSeconds(todaySubjectSeconds))}</strong>
                </div>
                <div>
                  <span>未完成待办</span>
                  <strong>{openTasks.length}</strong>
                </div>
              </div>
            </section>

            <section className="history-panel cloud-panel">
              <div className="section-head compact">
                <h2>云同步</h2>
                <Upload size={16} />
              </div>
              {renderCloudSyncSummary()}
              <details className="cloud-settings">
                <summary>高级设置</summary>
                <div className="cloud-form">
                <input
                  type="password"
                  value={syncConfig.token}
                  onChange={(event) => persistSyncConfig({ ...syncConfig, token: event.target.value })}
                  placeholder="GitHub Token（只保存在本设备）"
                />
                <input
                  value={syncConfig.gistId}
                  onChange={(event) => persistSyncConfig({ ...syncConfig, gistId: event.target.value.trim() })}
                  placeholder="Gist ID，可先留空后创建"
                />
                <input
                  value={syncConfig.fileName}
                  onChange={(event) => persistSyncConfig({ ...syncConfig, fileName: event.target.value })}
                  placeholder="kaidesk-data.json"
                />
                </div>
              </details>
              {cloudMessage && <p className="sync-message compact-sync">{cloudMessage}</p>}
            </section>

            <section className="history-panel">
              <div className="section-head compact">
                <h2>给 Codex 评价</h2>
                <Save size={16} />
              </div>
              <button className="primary-button codex-export-button" onClick={syncForCodex}>
                <Save size={17} />
                导出全站数据
              </button>
              {syncMessage && <p className="sync-message compact-sync">{syncMessage}</p>}
            </section>

            <section className="history-panel">
              <div className="section-head compact">
                <h2>休息想看</h2>
                <Clapperboard size={16} />
              </div>
              <div className="session-list">
                {openEntertainment.length === 0 && <p className="empty">娱乐清单还是空的。</p>}
                {openEntertainment.slice(0, 5).map((item) => (
                  <article key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.kind}</span>
                  </article>
                ))}
              </div>
            </section>

            <section className="history-panel">
              <div className="section-head compact">
                <h2>刚完成</h2>
                <CheckCircle2 size={16} />
              </div>
              <div className="session-list">
                {recentDoneTasks.length === 0 && <p className="empty">完成后的任务会留在这里。</p>}
                {recentDoneTasks.map((task) => (
                  <article key={task.id}>
                    <strong>{task.title}</strong>
                    <span>{taskScopeLabels[task.scope]}</span>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </section>
        </>
      )}

      {activeSection === "study" && (
        <>
      <section className="dashboard-grid">
        <section className="timer-panel">
          <div className="timer-ring" style={{ "--progress": `${Math.min(100, elapsedSeconds / 72)}%` } as React.CSSProperties}>
            <div>
              <span>{selectedSubjectConfig.name}</span>
              <strong>{formatClock(elapsedSeconds)}</strong>
              <small>随时中断，随时记录</small>
            </div>
          </div>
          <div className="timer-workbench">
            <div className="subject-picker" aria-label="选择本轮科目">
              {subjects.map((subject) => (
                <button
                  className={subject.id === selectedSubject ? "active" : ""}
                  key={subject.id}
                  onClick={() => setSelectedSubject(subject.id)}
                  type="button"
                  style={{ "--subject-color": subject.color } as React.CSSProperties}
                >
                  <span>{subject.shortName}</span>
                  {subject.name}
                </button>
              ))}
            </div>
            <div className="timer-actions">
              <button className="primary-button" onClick={() => setRunning((value) => !value)}>
                {running ? <Pause size={19} /> : <Play size={19} />}
                {running ? "暂停" : "开始"}
              </button>
              <button className="secondary-button" onClick={saveSession} disabled={elapsedSeconds <= 0}>
                <Save size={18} />
                记录本轮
              </button>
              <button className="icon-button" title="重置" onClick={resetSession}>
                <RotateCcw size={18} />
              </button>
            </div>
            {focusRestoreMessage && <p className="focus-restore-message">{focusRestoreMessage}</p>}
            <textarea
              value={sessionNote}
              onChange={(event) => setSessionNote(event.target.value)}
              placeholder="这轮学了什么？例如：张宇第 5 讲习题、数据结构二叉树、英语阅读精读。"
            />
          </div>
        </section>

        <section className="stats-panel">
          <article>
            <span>今日已专注</span>
            <strong>{formatDuration(todayTotalSeconds)}</strong>
            <small>数学 {formatDuration(todaySubjectSeconds.math)} · 408 {formatDuration(fourOhEightSeconds(todaySubjectSeconds))}</small>
          </article>
          <article>
            <span>{monthLabel(monthCursor)}已专注</span>
            <strong>{formatDuration(monthTotalSeconds)}</strong>
            <small>本月累计记录 {monthSessions.length} 次</small>
          </article>
          <article>
            <span>今日 408</span>
            <strong>{formatDuration(fourOhEightSeconds(todaySubjectSeconds))}</strong>
            <small>数据结构、计组、操作系统、计网合计</small>
          </article>
        </section>
      </section>

      <section className="subject-panel">
        <div className="section-head">
          <div>
            <p>今日科目分布</p>
            <h2>不设死标准，只看真实结构</h2>
          </div>
          <BookOpen size={19} />
        </div>
        <div className="subject-grid">
          {subjects.map((subject) => {
            const actual = todaySubjectSeconds[subject.id];
            const total = Math.max(todayTotalSeconds, 1);
            const progress = Math.min(100, Math.round((actual / total) * 100));
            return (
              <article key={subject.id}>
                <div>
                  <span style={{ background: subject.color }}>{subject.shortName}</span>
                  <strong>{subject.name}</strong>
                </div>
                <small>{formatDuration(actual)}</small>
                <div className="subject-bar">
                  <i style={{ width: `${progress}%`, background: subject.color }} />
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="subject-panel">
        <div className="section-head">
          <div>
            <p>进度记录</p>
            <h2>每天学完填一句到哪了</h2>
          </div>
          <Square size={16} />
        </div>
        <div className="progress-grid">
          <article>
            <strong>数学当前进度</strong>
            <span>{latestMath ? `${latestMath.content}（${latestMath.date}）` : "还没有记录"}</span>
            <input
              value={progressDraft.math}
              onChange={(event) => setProgressDraft({ ...progressDraft, math: event.target.value })}
              placeholder="例如：张宇基础 30 讲第 5 讲结束"
            />
            <button className="secondary-button" onClick={() => saveProgress("math")}>保存数学进度</button>
          </article>
          <article>
            <strong>408 当前进度</strong>
            <span>{latest408 ? `${latest408.content}（${latest408.date}）` : "还没有记录"}</span>
            <input
              value={progressDraft.fourOhEight}
              onChange={(event) => setProgressDraft({ ...progressDraft, fourOhEight: event.target.value })}
              placeholder="例如：数据结构第 1 章绪论结束"
            />
            <button className="secondary-button" onClick={() => saveProgress("fourOhEight")}>保存 408 进度</button>
          </article>
        </div>
        <div className="progress-actions">
          <button className="primary-button" onClick={completeCloudSync} disabled={cloudBusy}>
            <Upload size={17} />
            {cloudBusy ? "同步中" : "同步完成"}
          </button>
          <button className="secondary-button" onClick={exportData}>
            <Download size={17} />
            导出
          </button>
          <button className="secondary-button" onClick={() => fileInput.current?.click()}>
            <Upload size={17} />
            导入
          </button>
          <input ref={fileInput} className="hidden" type="file" accept="application/json" onChange={importData} />
        </div>
      </section>

      <section className="content-grid">
        <section className="calendar-panel">
          <div className="section-head">
            <div>
              <p>专注日历</p>
              <h2>{monthLabel(monthCursor)}</h2>
            </div>
            <div className="month-actions">
              <button className="icon-button" onClick={() => moveMonth(-1)} title="上个月">‹</button>
              <button className="icon-button" onClick={() => setMonthCursor(new Date())} title="回到本月">
                <CalendarDays size={17} />
              </button>
              <button className="icon-button" onClick={() => moveMonth(1)} title="下个月">›</button>
            </div>
          </div>
          <div className="week-row">
            {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {Array.from({ length: monthGrid.leading }).map((_, index) => (
              <span className="calendar-empty" key={`empty-${index}`} />
            ))}
            {monthGrid.days.map((day) => {
              const key = todayKey(day);
              const seconds = totalsByDate[key] || 0;
              const level =
                seconds >= 8 * 3600 ? 4 : seconds >= 4 * 3600 ? 3 : seconds >= 2 * 3600 ? 2 : seconds > 0 ? 1 : 0;
              return (
                <button
                  className={`day-cell level-${level} ${selectedDate === key ? "selected" : ""}`}
                  key={key}
                  onClick={() => setSelectedDate(key)}
                  title={`${key}: ${formatDuration(seconds)}`}
                >
                  <strong>{day.getDate()}</strong>
                  <span>{seconds ? `${Math.round(seconds / 3600)}h` : ""}</span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="side-panel">
          <section className="history-panel">
            <div className="section-head compact">
              <h2>{selectedDate} 明细</h2>
              <Square size={16} />
            </div>
            <div className="month-subject-list">
              {subjects.map((subject) => (
                <div key={subject.id}>
                  <span>{subject.name}</span>
                  <strong>{formatDuration(selectedDayTotals[subject.id])}</strong>
                </div>
              ))}
            </div>
            <div className="session-list day-progress-list">
              {selectedDayProgress.length === 0 && <p className="empty">这天没有进度记录。</p>}
              {selectedDayProgress.map((entry) => (
                <article key={entry.id}>
                  <strong>{entry.area === "math" ? "数学" : "408"}</strong>
                  <span>{entry.content}</span>
                  {entry.note && <p>{entry.note}</p>}
                </article>
              ))}
            </div>
          </section>

          <section className="history-panel">
            <div className="section-head compact">
              <h2>本月每科时间</h2>
              <Square size={16} />
            </div>
            <div className="month-subject-list">
              {subjects.map((subject) => (
                <div key={subject.id}>
                  <span>{subject.name}</span>
                  <strong>{formatDuration(monthSubjectSeconds[subject.id])}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="history-panel">
            <div className="section-head compact">
              <h2>最近记录</h2>
              <Square size={16} />
            </div>
            <div className="session-list">
              {recentSessions.length === 0 && <p className="empty">还没有记录。开始第一轮专注吧。</p>}
              {recentSessions.map((session) => (
                <article className="session-record" key={session.id}>
                  <div className="item-main">
                    <strong>{formatDuration(session.seconds)}</strong>
                    <span>
                      {session.date} · {subjectById[session.subject].name}
                    </span>
                    {session.note && <p>{session.note}</p>}
                  </div>
                  <button className="icon-button danger" onClick={() => deleteSession(session.id)} title="删除记录">
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </section>
        </>
      )}

      {activeSection === "fun" && (
        <>
        <section className="subject-panel fun-panel">
          <div className="section-head">
            <div>
              <p>娱乐清单</p>
              <h2>休息想看的东西别靠脑子硬记</h2>
            </div>
            <Clapperboard size={19} />
          </div>
          <div className="fun-composer">
            <input
              value={funDraft.title}
              onChange={(event) => setFunDraft({ ...funDraft, title: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") addEntertainment();
              }}
              placeholder="例如：某部电影、番剧、纪录片、游戏"
            />
            <input
              value={funDraft.kind}
              onChange={(event) => setFunDraft({ ...funDraft, kind: event.target.value })}
              placeholder="类型：电影 / 剧 / 游戏 / 书"
            />
            <button className="primary-button" onClick={addEntertainment}>
              <Save size={17} />
              添加
            </button>
            <textarea
              value={funDraft.note}
              onChange={(event) => setFunDraft({ ...funDraft, note: event.target.value })}
              placeholder="可选备注：哪里看到的、为什么想看、适合什么时候休息看。"
            />
          </div>
          <div className="fun-list">
            {data.entertainment.length === 0 && <p className="empty">还没有记录。以后突然想起想看的东西，就丢到这里。</p>}
            {data.entertainment.map(renderEntertainmentItem)}
          </div>
        </section>
        </>
      )}
    </main>
  );
}
