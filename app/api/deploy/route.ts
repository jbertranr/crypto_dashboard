export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * API de desplegament — GET /api/deploy, POST /api/deploy
 *
 * GET  → estat de producció (commit, pm2, releases)
 * POST → { action: "deploy", branch? } | { action: "rollback", release }
 *        Retorna { jobId } — el client segueix l'output via GET /api/deploy/stream?jobId=xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn }  from "child_process";
import { randomBytes } from "crypto";

// ── Job store global ──────────────────────────────────────────────────────────

export interface DeployJob {
  id:        string;
  action:    "deploy" | "rollback";
  startedAt: number;
  done:      boolean;
  exitCode:  number | null;
  lines:     string[];          // totes les línies acumulades
  listeners: Set<(line: string) => void>;
}

declare global {
  var __deployJobs: Map<string, DeployJob> | undefined;
}

export const deployJobs: Map<string, DeployJob> =
  (global.__deployJobs ??= new Map());

// Neteja jobs antics (> 30 min)
function pruneJobs() {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, job] of deployJobs) {
    if (job.done && job.startedAt < cutoff) deployJobs.delete(id);
  }
}

// ── SSH helper ────────────────────────────────────────────────────────────────

const SSH_ALIAS = "cryptdesk-prod";
const PROD_DIR  = "/var/oled/cryptdesk/crypto_dashboard";

function runSsh(remoteCmd: string, job: DeployJob): void {
  const proc = spawn("ssh", [SSH_ALIAS, remoteCmd], { shell: false });

  const emit = (raw: string) => {
    const line = raw.replace(/\r/g, "").trimEnd();
    if (!line) return;
    job.lines.push(line);
    for (const fn of job.listeners) fn(line);
  };

  proc.stdout.on("data", (d: Buffer) => d.toString().split("\n").forEach(emit));
  proc.stderr.on("data", (d: Buffer) => d.toString().split("\n").forEach(l => emit(`⚠ ${l}`)));

  proc.on("close", code => {
    job.exitCode = code;
    job.done     = true;
    emit(`\n── Procés finalitzat (codi ${code}) ──`);
    for (const fn of job.listeners) fn("\x00EOF");  // sentinel
    job.listeners.clear();
  });

  proc.on("error", err => {
    emit(`❌ Error SSH: ${err.message}`);
    job.done     = true;
    job.exitCode = -1;
    for (const fn of job.listeners) fn("\x00EOF");
    job.listeners.clear();
  });
}

// ── GET — estat de producció ──────────────────────────────────────────────────

export async function GET() {
  try {
    const [statusOut, releasesOut] = await Promise.all([
      sshExec(`cd ${PROD_DIR} && git log -1 --pretty=format:'%h|%s|%ci' && echo '' && pm2 jlist 2>/dev/null | python3 -c "import json,sys; apps=json.load(sys.stdin); [print(a['name']+'|'+str(a.get('pm2_env',{}).get('status','?'))+'|'+str(int(a.get('pm2_env',{}).get('pm_uptime',0)))+'|'+str(a.get('pid','?'))) for a in apps]" 2>/dev/null || true`),
      sshExec(`ls -1t ${PROD_DIR}/releases/ 2>/dev/null | head -10 || echo ''`),
    ]);

    // Parse git info
    const [gitLine, ...pm2Lines] = statusOut.trim().split("\n");
    const [commit, message, date] = (gitLine ?? "").split("|");

    // Parse pm2
    const pm2 = pm2Lines.filter(Boolean).map(l => {
      const [name, status, uptime, pid] = l.split("|");
      return { name, status, uptime: parseInt(uptime) || 0, pid };
    });

    // Parse releases
    const releases = releasesOut.trim().split("\n").filter(Boolean).map(name => {
      const parts = name.split("_");
      const commitHash = parts[2] ?? "—";
      // YYYYMMDD_HHMMSS_hash
      const dateStr = parts[0] && parts[1]
        ? `${parts[0].slice(0,4)}-${parts[0].slice(4,6)}-${parts[0].slice(6,8)} ${parts[1].slice(0,2)}:${parts[1].slice(2,4)}:${parts[1].slice(4,6)}`
        : "—";
      return { name, date: dateStr, commit: commitHash };
    });

    return NextResponse.json({ commit, message, date, pm2, releases });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

async function sshExec(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ssh", [SSH_ALIAS, cmd], { shell: false });
    let out = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr.on("data", () => {});
    proc.on("close", code => code === 0 || out ? resolve(out) : reject(new Error(`ssh exit ${code}`)));
    proc.on("error", reject);
  });
}

// ── POST — llança un job ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json() as { action?: string; branch?: string; release?: string };
  const { action, branch = "master", release } = body;

  if (action !== "deploy" && action !== "rollback") {
    return NextResponse.json({ error: "action ha de ser 'deploy' o 'rollback'" }, { status: 400 });
  }
  if (action === "rollback" && !release) {
    return NextResponse.json({ error: "release és obligatori per a rollback" }, { status: 400 });
  }

  pruneJobs();

  const jobId = randomBytes(6).toString("hex");
  const job: DeployJob = {
    id: jobId, action: action as "deploy" | "rollback",
    startedAt: Date.now(), done: false, exitCode: null,
    lines: [], listeners: new Set(),
  };
  deployJobs.set(jobId, job);

  const remoteCmd = action === "deploy"
    ? `bash ${PROD_DIR}/scripts/remote-deploy.sh ${branch}`
    : `bash ${PROD_DIR}/scripts/rollback.sh ${release}`;

  // Llança asíncronament
  setImmediate(() => runSsh(remoteCmd, job));

  return NextResponse.json({ jobId });
}
