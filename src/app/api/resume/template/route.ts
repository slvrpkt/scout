import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { queueDraftRedo } from "@/lib/jobs/redo-drafts";
import { RESUME_MAX_BYTES } from "@/lib/resume-text";
import { templateFromLayout } from "@/lib/resume-template";
import { resumeLayout } from "@/lib/resume-template-read";
import { route } from "@/lib/route";
import { saveSettings } from "@/lib/settings-data";

/**
 * Your template: reads a resume file's layout, sent as the request body, for
 * base and tailored resumes to follow. Only the layout is kept, not the file.
 * Unsent drafts are then rewritten; sent ones keep the layout they went out in.
 * A route handler, since Server Actions take at most 1 MB.
 */
export const POST = route(async (request) => {
  if (Number(request.headers.get("content-length") ?? 0) > RESUME_MAX_BYTES) {
    return NextResponse.json({ error: "That file is over 5 MB." }, { status: 413 });
  }
  const layout = await resumeLayout(new Uint8Array(await request.arrayBuffer()));
  if ("error" in layout) return NextResponse.json({ error: layout.error }, { status: 400 });
  const name = new URL(request.url).searchParams.get("name") ?? "Your resume";
  const template = templateFromLayout(layout, name);
  if (!template) {
    return NextResponse.json({ error: "Scout couldn't find this resume's sections, like Experience and Education. If it's a scan or an image, export it from the program you wrote it in." }, { status: 400 });
  }
  await saveSettings({ resumeTemplate: template, baseFitStep: 0 });
  revalidatePath("/resume");
  return NextResponse.json({ template, redoing: await queueDraftRedo() });
});

/** Removes it: resumes go back to the theme's own layout. */
export const DELETE = route(async () => {
  await saveSettings({ resumeTemplate: null, baseFitStep: 0 });
  revalidatePath("/resume");
  return NextResponse.json({ redoing: await queueDraftRedo() });
});
