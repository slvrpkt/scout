import { NextResponse } from "next/server";

import { DOCX_TYPE } from "@/lib/docx/render";
import { fileDownload, heldFile } from "@/lib/pdf/downloads";
import { route } from "@/lib/route";

const GONE = "That Word file isn't here any more. Download it again.";

/** Hands over a Word file that `POST /api/docx` built and held for a few minutes. */
export const GET = route<RouteContext<"/api/docx/[id]">>(async (_request, { params }) => {
  const held = heldFile((await params).id, DOCX_TYPE);
  return held ? fileDownload(held.file, held.fileName, DOCX_TYPE) : NextResponse.json({ error: GONE }, { status: 404 });
});
