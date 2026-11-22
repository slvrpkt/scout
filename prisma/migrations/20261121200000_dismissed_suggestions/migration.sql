-- Suggestions dismissed on a resume, folded away under the rest.
ALTER TABLE "Application" ADD COLUMN "dismissedSuggestions" TEXT[] DEFAULT ARRAY[]::TEXT[];
