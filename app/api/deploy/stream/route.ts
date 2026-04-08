export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deploy/stream?jobId=xxx
 * SSE stream de l'output d'un job de desplegament.
 */

import { type NextRequest } from "next/server";
import { deployJobs } from "../route";

const enc = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return new Response("jobId requerit", { status: 400 });

  const job = deployJobs.get(jobId);
  if (!job) return new Response("Job no trobat", { status: 404 });

  const stream = new ReadableStream({
    start(ctrl) {
      // Envia les línies ja acumulades
      for (const line of job.lines) {
        ctrl.enqueue(sse("line", { text: line }));
      }

      if (job.done) {
        ctrl.enqueue(sse("done", { exitCode: job.exitCode }));
        ctrl.close();
        return;
      }

      // Subscriu a les noves línies
      const onLine = (line: string) => {
        if (line === "\x00EOF") {
          ctrl.enqueue(sse("done", { exitCode: job.exitCode }));
          ctrl.close();
          job.listeners.delete(onLine);
        } else {
          try {
            ctrl.enqueue(sse("line", { text: line }));
          } catch {
            job.listeners.delete(onLine);
          }
        }
      };
      job.listeners.add(onLine);

      // Keepalive cada 20s
      const keepalive = setInterval(() => {
        try { ctrl.enqueue(sse("ping", {})); }
        catch { clearInterval(keepalive); }
      }, 20_000);

      // Cleanup quan el client es desconnecta
      req.signal.addEventListener("abort", () => {
        clearInterval(keepalive);
        job.listeners.delete(onLine);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}
