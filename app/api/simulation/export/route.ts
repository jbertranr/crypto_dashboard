import { NextRequest, NextResponse } from "next/server";
import { apiError } from "../../../lib/api-error";
import fs   from "fs";
import path from "path";

const REPORTS_DIR = path.join(process.cwd(), "reports");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { filename: string; content: unknown };
    const { filename, content } = body;

    if (!filename || !content) {
      return NextResponse.json({ error: "Falten filename o content" }, { status: 400 });
    }

    // Sanitza el nom per evitar path traversal
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9_\-\.]/g, "_");
    const finalName = safeName.endsWith(".json") ? safeName : `${safeName}.json`;

    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    const filePath = path.join(REPORTS_DIR, finalName);
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2), "utf-8");

    return NextResponse.json({ ok: true, filename: finalName, path: `reports/${finalName}` });
  } catch (e) {
    return apiError(e, "simulation/export");
  }
}

export async function GET() {
  try {
    if (!fs.existsSync(REPORTS_DIR)) {
      return NextResponse.json({ reports: [] });
    }

    const files = fs.readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        const stat = fs.statSync(path.join(REPORTS_DIR, f));
        return { filename: f, size: stat.size, createdAt: stat.birthtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return NextResponse.json({ reports: files });
  } catch (e) {
    return apiError(e, "simulation/export");
  }
}
