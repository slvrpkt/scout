import { redirect } from "next/navigation";

/** Archived applications are in the Archive now, with archived postings. */
export default function ArchivedApplicationsPage() {
  redirect("/archive");
}
