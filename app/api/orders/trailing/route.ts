import { NextResponse } from "next/server";
import { trailingGetAll } from "../../../lib/cache-store";

export async function GET() {
  return NextResponse.json(trailingGetAll());
}
