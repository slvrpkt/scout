# Release notes

## Scout 1.12.0 (November 2026)

The biggest update since Scout went public: about 140 changes across finding jobs, writing resumes, applying and keeping track. The theme throughout is less time per application, with you in control of everything that goes out.

### Highlights

- **Fix what several drafts are missing, all at once.** When two or more drafts ask for the same thing your resume doesn't say, Scout groups them into one question. Answer it once and it's kept in your profile and added to the drafts you choose. An answered question never comes back under a different name.
- **Suggestions that understand your resume.** Suggestions are judged by meaning rather than matching words, so you're never asked to add what your resume already says. Dismiss one, or mark it not true and it's never suggested again on any job.
- **Resumes that tell a story.** Each job's bullets now lead with the business and its problem, then what you did, then the results. The summary is written last, from the finished resume.
- **A roomier, calmer workspace.** Dashboards, filters and job cards take half the space they did, the resume opens larger and centered, pages refresh themselves when something changes, and every button and link explains itself when you hover over it.
- **Built for a modest budget.** Automatic drafts are sent to the AI in batches at half the price, cover letters are written only when you ask for one, the company-site check uses a single web search, and the agent rests on weekends unless you want it to run. The aim is a complete job search for under $20 a month in API fees.

### Finding jobs

- Before drafting, the agent looks for each job on the employer's own site, for the full description and the employer's own apply page.
- Follow up to 10 companies per search, across your whole country, and give each search up to 5 alternative job titles.
- Drafts to review, then score bands ten points apart, with drafts ordered by fit score and then resume grade.
- New tiles for the last run, today, this week, this month and all time, with counts that never go down.
- Runs start at the minute you set, can skip Saturdays and Sundays, and pick up where they left off after a restart.
- Save for later: a button on every job and a page of its own.
- Each job card shows up to three places to apply, the employer's own page first.
- Postings that look cut short are flagged, and so are resume screening traps (hidden instructions meant to catch AI-written applications), which are kept out of your documents.
- A job's page links back to exactly where you found it, with that job still selected.

### Writing resumes and cover letters

- Change any job's title, company, place, dates and skills line on a tailored resume, by clicking it or by asking in the chat.
- The chat gathers up to five changes and makes them in one go. It asks a clarifying question when a request is unclear, and asks whether something new applies to this job only or to all of them.
- Exact page limits: a resume asked to be shorter is genuinely shorter, rewritten rather than cut off, and the PDF and Word file fit the same way.
- Regrade a resume against the posting after you edit it. The grade understands skills written as "SDLC/SELC".
- A "Before you apply" note for things a resume can't show (clearance, travel, relocation), leaving out what your background already covers.
- Cover letters in a standard business-letter format: three short paragraphs on half a page, written on request in a minute or two. Regenerate one, or mark an application as going without one.
- Replace a job description that came through incomplete, and both documents are rewritten for the full one.

### Applying and keeping track

- Quick Apply downloads your resume and cover letter, copies the letter for pasting, opens the employer's page and marks the job applied when you're done. Undo it any time.
- Drafts stay under Agentic or Manual job search until you apply, then join your Job application log.
- New manual application, for a job you found yourself or one someone sent you.
- The Inbox works like a mail program, with a reading pane, unread and important flags, filters and search. Answers can be formatted, with fonts, lists and links.
- Record the salary you asked for on each application. It shows in the log, its activity and the Google Sheet.
- The Google Sheet updates a few seconds after you apply, with a clearer layout.
- Archive charts and a Clear the Archive option. Backups show how much room they take, and old ones can be cleared.

### Under the hood

- Next.js 16.4.6, the patched release for a known security issue, plus stricter cost-limit checks that stop a request when the limit can't be confirmed.
- Background jobs interrupted by a restart start again on their own.
- The full test suite now passes on Windows too.
- README screenshots retaken, with a new architecture diagram.

## Scout 1.11.0 (November 2026)

The first public release of Scout: an agentic job search, fit scoring, tailored resumes checked against common ATS criteria, and a job application log, built on [Dossier](https://github.com/AienTech/dossier).
