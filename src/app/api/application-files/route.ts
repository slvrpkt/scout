import { type NextRequest, NextResponse } from "next/server";

import { documentsFile, postingFile, type ApplicationFile } from "@/lib/application-files";
import { fileDownload, holdFile } from "@/lib/pdf/downloads";
import { route } from "@/lib/route";

/** Application ids are cuids; anything else never reaches a print path. */
const APPLICATION_ID = /^[a-z0-9]{1,64}$/i;

/**
 * The Job application log's downloads: `?application={id}&file=documents`
 * for the resume and cover letter as one file, in the format the application
 * went out in, or `&file=posting` for the job description as a Word file.
 */
export const GET = route(async (request) => {
  const built = await build(request);
  return built instanceof Response ? built : fileDownload(built.file, built.fileName, built.contentType);
});

/** Builds the same file and holds it for a few minutes, answering `{ url }` (see POST /api/pdf). */
export const POST = route(async (request) => {
  const built = await build(request);
  if (built instanceof Response) return built;
  return NextResponse.json({ url: `/api/application-files/${holdFile(built.file, built.fileName, built.contentType)}` });
});

async function build(request: NextRequest): Promise<ApplicationFile | Response> {
  const params = request.nextUrl.searchParams;
  const id = params.get("application") ?? "";
  const which = params.get("file");
  if (!APPLICATION_ID.test(id) || (which !== "documents" && which !== "posting")) return NextResponse.json({ error: "There's no such file to download." }, { status: 404 });
  const built = which === "documents" ? await documentsFile(id) : await postingFile(id);
  if (!built) {
    const error = which === "documents" ? "This application has no resume to download." : "No job description was saved with this application.";
    return NextResponse.json({ error }, { status: 404 });
  }
  return built;
}
