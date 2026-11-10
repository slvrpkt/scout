"use client";

import { ChevronDown } from "lucide-react";

import { downloadHeld } from "@/components/documents/download-pdf-button";
import { buttonClassName } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** One Download button for the document on screen, with a choice of PDF or Word. */
export function DownloadMenu({ id, doc }: { id: string; doc: "resume" | "letter" }) {
  const what = doc === "letter" ? "custom tailored cover letter" : "custom tailored resume";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonClassName("secondary", "md", "data-[state=open]:border-primary")}>
        Download
        <ChevronDown size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[180px]">
        <DropdownMenuItem onSelect={() => void downloadHeld(`/api/pdf?doc=${doc}&application=${id}`, `Rendering your ${what} as a PDF…`)}>PDF</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void downloadHeld(`/api/docx?doc=${doc}&application=${id}`, `Building your ${what} as a Word file…`)}>
          Word
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
