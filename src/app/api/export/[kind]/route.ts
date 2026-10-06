import { headers } from "next/headers";
import { exportRows, isExportKind } from "@/db/queries/export";
import { auth } from "@/lib/auth";
import { toCsv } from "@/lib/csv";

// GET /api/export/contacts (or companies, deals, activities, tasks): the owner's data as CSV.
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Sign in first.", { status: 401 });
  const { kind } = await params;
  if (!isExportKind(kind)) return new Response("Unknown export.", { status: 404 });
  const { columns, rows } = await exportRows(session.user.id, kind);
  const stamp = new Date().toISOString().slice(0, 10);
  // The byte-order mark makes Excel read the file as UTF-8.
  return new Response(`﻿${toCsv(columns, rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rapport-${kind}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
