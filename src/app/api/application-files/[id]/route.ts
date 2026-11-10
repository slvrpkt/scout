import { NextResponse } from "next/server";

import { DOCX_TYPE } from "@/lib/docx/render";
import { fileDownload, heldFile, PDF_TYPE } from "@/lib/pdf/downloads";
import { route } from "@/lib/route";

const GONE = "That file isn't here any more. Download it again.";

/** Hands over a file that `POST /api/application-files` built and held for a few minutes. */
export const GET = route<RouteContext<"/api/application-files/[id]">>(async (_request, { params }) => {
  const { id } = await params;
  for (const type of [PDF_TYPE, DOCX_TYPE]) {
    const held = heldFile(id, type);
    if (held) return fileDownload(held.file, held.fileName, type);
  }
  return NextResponse.json({ error: GONE }, { status: 404 });
});
