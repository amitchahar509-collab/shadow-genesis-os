// Shared Genesis OS types (mirror Prisma models; JSON fields parsed)

export type TaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "REVIEW"
  | "DONE"
  | "FAILED";

export type TaskPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type ActivityLevel = "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "CRITICAL";

export interface GenesisTask {
  id: string;
  taskId: string;
  title: string;
  description: string;
  ownerAgent: string;
  department: string;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number;
  dependencies: string; // JSON array
  expectedArtifact: string;
  validation: string;
  estimatedHours: number;
  actualHours: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Department {
  id: string;
  key: string;
  name: string;
  mission: string;
  status: string;
  health: number;
  activeAgents: number;
  completedTasks: number;
  pendingTasks: number;
  load: number;
  metrics: string; // JSON
  updatedAt: string;
}

export interface MemoryEntry {
  id: string;
  type: "EPISODIC" | "SEMANTIC" | "PROCEDURAL";
  title: string;
  content: string;
  tags: string; // JSON array
  importance: number;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CeoDecision {
  id: string;
  title: string;
  rationale: string;
  decision: string;
  impact: string;
  status: string;
  createdAt: string;
}

export interface ResearchReport {
  id: string;
  topic: string;
  category: string;
  summary: string;
  findings: string; // JSON array
  evidence: string; // JSON array
  confidence: number;
  status: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  agent: string;
  action: string;
  detail: string;
  level: ActivityLevel;
  category: string;
  taskId: string | null;
  createdAt: string;
}

export interface SystemMetric {
  id: string;
  name: string;
  value: number;
  unit: string;
  category: string;
  target: number | null;
  updatedAt: string;
}

export interface BuildCheckpoint {
  id: string;
  version: string;
  type: string;
  summary: string;
  changesCount: number;
  testsPassed: number;
  testsFailed: number;
  status: string;
  createdAt: string;
}

export interface OperationalLoop {
  id: string;
  key: string;
  name: string;
  description: string;
  status: string;
  cycleCount: number;
  lastRunAt: string | null;
  interval: string;
  healthScore: number;
  detail: string | null;
  updatedAt: string;
}

export interface GenesisSummary {
  state: Record<string, string>;
  departments: Department[];
  metrics: SystemMetric[];
  loops: OperationalLoop[];
  tasks: GenesisTask[];
  recentActivity: ActivityLog[];
  decisions: CeoDecision[];
  checkpoints: BuildCheckpoint[];
  statusCounts: Record<string, number>;
  priorityCounts: Record<string, number>;
}

export const DEPARTMENT_META: Record<
  string,
  { icon: string; accent: "emerald" | "cyan" | "amber" | "rose" | "violet"; label: string }
> = {
  ceo: { icon: "Crown", accent: "amber", label: "CEO" },
  research: { icon: "Telescope", accent: "cyan", label: "RESEARCH" },
  product: { icon: "DraftingCompass", accent: "violet", label: "PRODUCT" },
  engineering: { icon: "Terminal", accent: "emerald", label: "ENGINEERING" },
  ai_systems: { icon: "BrainCircuit", accent: "emerald", label: "AI SYSTEMS" },
  design: { icon: "Palette", accent: "rose", label: "DESIGN" },
  growth: { icon: "TrendingUp", accent: "cyan", label: "GROWTH" },
  quality: { icon: "ShieldCheck", accent: "amber", label: "QUALITY" },
};

export const STATUS_COLOR: Record<TaskStatus, string> = {
  PENDING: "chip-zinc",
  IN_PROGRESS: "chip-cyan",
  BLOCKED: "chip-rose",
  REVIEW: "chip-amber",
  DONE: "chip-emerald",
  FAILED: "chip-rose",
};

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  CRITICAL: "chip-rose",
  HIGH: "chip-amber",
  MEDIUM: "chip-cyan",
  LOW: "chip-zinc",
};

export const LEVEL_COLOR: Record<ActivityLevel, string> = {
  INFO: "chip-cyan",
  SUCCESS: "chip-emerald",
  WARNING: "chip-amber",
  ERROR: "chip-rose",
  CRITICAL: "chip-rose",
};

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
