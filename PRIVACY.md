# Privacy

Scout is a single-user app you run on your own computer. This page is for whoever runs it: what Scout keeps and for how long, what leaves your computer and who receives it, and what deleting something removes. For how the data is protected, see [SECURITY.md](SECURITY.md).

In short: everything you enter is kept in your own PostgreSQL database and data directory, on your computer. What leaves it goes to the AI provider and job source you choose; to employers' own sites and hiring systems when Scout looks up a job there; to Google if you connect Gmail and Calendar; to TypeSafe if you choose Jev for scoring; to Anthropic through Claude, or another app you connect, if you turn on the MCP connector; and to GitHub only if you switch on the update check (it's off to start with). Scout has no telemetry and sends nothing to the Scout project. With a local model, your profile, postings and documents never leave your computer. With a hosted one, keeping the database on your computer covers only part of where your data goes.

## What Scout keeps

| What | Where | Kept until |
|---|---|---|
| Your profile: basics with contact details and your photo, skills, languages, roles, projects, education, publications, references with their email and phone, and your facts about you | Database | You change or delete it |
| Each application: the posting, what was read from it, the match, the facts you gave for it, its status history | Database | You delete the application |
| Each application's resume, cover letter and email, every earlier version of them, the refine chat and your private notes | Database | You delete the application |
| Postings you saved or archived in Manual job search, and your past searches with what they found | Database | You remove them. A posting stays, unlinked, when you delete the application made from it |
| The job agent's finds: each posting it scored, with its score, reasons and red flags, and the drafts it prepared. Of a posting you dismissed, only its source's ID, its title and company, and a fingerprint of its link, so it never comes back | Database | Dismissing a posting trims it at once and deletes its draft. Delete everything removes them all |
| The scores of postings you scored with **Score** in Manual job search, or the job agent scored: each score with its reasons and red flags | Database | Scoring again replaces one. Importing a file or Delete everything removes them; exports leave them out, since they can be made again |
| Postings you hand to Claude chat from New application, with **Write it with Claude**, for the MCP connector to read | Database | 14 days, or Delete everything |
| Task data: what each AI task was given and wrote, such as a posting being read, a resume's text and what was read from it, drafts you didn't turn into an application, and a rewrite kept for Undo | Database | The task's application is deleted, or it's older than **Keep task data for** (Settings → Your data: 1 hour, 24 hours, 7 days or 30 days; 24 hours by default), whichever comes first. A resume reading goes as soon as you merge, replace or choose another file |
| Mail from Gmail about your applications, once you connect Google: who it's from and to, the subject, the date and the text (without quoted earlier mail, up to 20,000 characters, never attachments), what the AI read in it, and the answer it drafted. Also what you sent through Scout, and your own mail in those threads | Database | You delete its application. Mail Scout couldn't link (**Needs a look**) stays until you link it or mark it **Not job-related**, which keeps only its Gmail IDs and date, so it isn't fetched again |
| The connected Google account: its address, the permissions you gave, and Google's refresh token, encrypted with `DOSSIER_SECRET`. Where the inbox check carries on from, and when it last ran. For each interview Scout added to your calendar, the event's ID | Database | **Disconnect** in Settings → Google, or Delete everything. An interview's event ID goes when its date does |
| Settings, and your API keys and the Google OAuth client's secret, encrypted with `DOSSIER_SECRET`. While the MCP connector is on, when it was turned on or every app was last disconnected, and the callback addresses of other apps you added; the sign-in itself keeps nothing: its tokens are signed with `DOSSIER_SECRET` | Database | You change them |
| Nightly backups and the backup taken before each import: full exports, in plain JSON | Data directory, `backups` | `DOSSIER_BACKUP_RETENTION_DAYS`, 14 days by default |
| Zips from **Download all PDFs** | Data directory, `downloads` | Downloaded, or an hour |
| Failed sign-ins: the client IP and how many failed | Database | A successful sign-in from that IP. Otherwise, once they're a day old, the next failed sign-in clears them |
| The latest release the update check found, and your browser's time zone, so the inbox check reads times in it | Database | Delete everything |

Exports you download and database dumps you take are copies outside Scout's reach: keep them safe, and delete them yourself. Scout logs errors without the data involved; what your computer, Docker or reverse proxy log otherwise is up to your setup.

## What deleting removes

- **Deleting an application** removes it at once with its documents and their versions, the chat, notes, status history, task data and its mail from Gmail (which stays in Gmail). Nightly backups taken before still hold it until they expire, and so do exports you downloaded.
- **Delete everything** (Settings → Your data) removes the profile, every application, postings and searches, the job agent's finds, custom themes, settings, task data, backups and zips, the mail from Gmail and the Google account, after revoking Scout's access at Google. It can't reach your own exports and dumps, what's in your Gmail and calendar, or what a hosted AI provider kept.
- **Disconnect** (Settings → Google) revokes Scout's access at Google and forgets the account. Mail already in Scout stays, with its applications.
- **Disconnect all apps** (Settings → MCP connector) signs Claude and every other app out, and so do turning the connector off, a new `DOSSIER_PASSWORD` or a new `DOSSIER_SECRET`. What an app read before stays with it: for Claude, in your Claude chats, under your Claude account.

## What leaves your computer

| Who receives it | When | What |
|---|---|---|
| A hosted AI provider (OpenAI-compatible, Anthropic or Mistral) | Each AI task, while one is chosen in Settings → AI provider | See [below](#what-a-hosted-ai-provider-receives) |
| Google | While a Google account is connected (Settings → Google) | Signing in: your OAuth client's ID and secret, and the tokens. **Gmail:** the application emails and answers you send, with their PDFs, and a request for new mail on each check (every 10 minutes by default). **Calendar:** the next 14 days, to find your free times; each interview you add, change or remove: its time and a title with the role and company; and requests for the events in the months you look at in the dashboard's calendar, which Scout shows and doesn't keep. Google already holds your mail and calendar; Scout only asks for the permissions you give |
| The job source you chose (JSearch by default; Adzuna, FreeHire and the Bundesagentur für Arbeit are also offered) | Each search in Manual job search, which is off until you choose a source, and the job agent's searches, at the times you set in Settings → Job agent (up to 8 a day, never on the Bundesagentur für Arbeit) | What you search for: keywords, place, country, radius and filters. Nothing from your profile: it only fills in the form. FreeHire is a public catalogue (or your self-hosted FreeHire via `DOSSIER_FREEHIRE_URL`) and needs no key. The Bundesagentur für Arbeit has no official API: Scout uses the access its own job search uses, without its permission, so it's searched only after you tick "I understand" under that note, and `DOSSIER_JOBS_ARBEITSAGENTUR=off` takes it out |
| Employers' own sites and hiring systems (Greenhouse, Lever, Ashby, Workday) | Before the job agent drafts a job, and when you press **Look on company website**: Scout looks for the job where the employer published it, for its full description and the page to apply on | Requests for the employer's public job listings and the job's page, from your computer. Nothing about you |
| TypeSafe (Jev) | Each posting you score, with **Score** in Manual job search or by the job agent, only while **Jev by TypeSafe** is chosen in Settings → Scoring (your AI model scores until you choose it) | See [below](#what-typesafe-receives) |
| Anthropic, through Claude | Only while the MCP connector is on (Settings → MCP connector, off by default), and only for the Claude you signed in and allowed: each time Claude uses one of Scout's tools | What that tool answers. See [MCP connector](#mcp-connector) |
| Another MCP app you connect, such as n8n | Only while the MCP connector is on, only for an app whose callback address you added in Settings → MCP connector, and only after you signed in and allowed it: each time it uses one of Scout's tools | What that tool answers, to whoever runs the app. See [MCP connector](#mcp-connector) |
| The site a posting is on | When you press **Fetch** on a new application, and for a posting that came with only its start | A request for the posting's page, from your computer, never to an address on your own network |
| GitHub | Once on each day Scout is used, while **Check for updates daily** is on in Settings → About (it's off until you switch it on), and when you press **Check for updates** | A request for the latest release, from your computer. Nothing about you or your install, though GitHub sees your internet address, as with any request |

Nothing else is sent. Your browser loads nothing from other sites (the Content-Security-Policy forbids it), and Next.js telemetry is off.

### What a hosted AI provider receives

| Task | What's sent |
|---|---|
| Reading a posting | The posting's text, up to 20,000 characters |
| Matching it against your profile | The posting's requirements, and the names of your skills and languages |
| Writing the resume, cover letter and email | Your profile without contact details: your name, headline, city and country, summary, skills, languages, roles with their companies, places, the line about each company or role, dates and bullet points, projects with their dates and bullet points (not their links), education, the publications you show on resumes (not their links), and your facts about you. Also the job's details and the match, the letter's tone, and the facts you gave for the application. The email also gets the posting and the letter's paragraphs |
| Rewriting a part, or refining in the chat | The same, with the drafts (never a letter's sender or signature) and, in the chat, your request and the recent messages before it |
| Importing a resume | The whole text of the file, contact details and references included. The import page says so first |
| Scoring a posting, with **Score** in Manual job search or by the job agent, unless Settings → Scoring chose Jev | The posting's text, with its title, company, place and salary, and your profile without contact details or references, as for writing. Score in Manual job search fetches the rest of a posting the source sent only the start of. Each time you press Score, and up to the number of postings an agent run scores (Settings → Job agent) |
| Finding a job on the employer's site, with Anthropic (Claude) only, when the employer's own listings didn't have it | The job's title, company, place and the company's website. Claude runs one web search for the job's official page; Scout then reads that page itself and keeps it only if the title and company match |
| The job agent's drafts | The same as reading a posting and writing its resume and cover letter, for each draft you prepare or, with Prepare drafts on its own on, up to the number a run prepares |
| Reading a reply from Gmail | The mail's sender, subject, date and text (up to 8,000 characters), the application's role and company, and your time zone. With **Every new email** in Settings → Google, that's each new mail outside Promotions and Social |
| Drafting an answer to it | Your profile without contact details, as for the documents, the job's details and the facts you gave for it, the mail and up to four earlier ones in its thread (up to 2,000 characters each), the times to offer, and what you tell the AI |

Never sent in a prompt: your email, phone, address, date of birth and links, your references, and the notes you keep on an application. An email's recipient is filled in on your computer. A posting may name a contact person, a mail from an employer has its sender's name and address, and what you write in the chat may mention people, so other people's details can still be sent.

What happens to the data then depends on the provider and your account with them: how long they keep it, whether they use it to train models, and where it's processed. Read their terms for API use, and check the settings your account offers, before you send them a resume. A local model (Ollama, LM Studio or another OpenAI-compatible server on your own network) keeps everything on it.

### What TypeSafe receives

With **Jev by TypeSafe** chosen in Settings → Scoring, each posting you score goes to TypeSafe AI, Inc. instead of your AI provider: the posting's text (up to 20,000 characters) with its title, company, place, salary and whether it's remote, and your profile without your name, contact details or references: your headline, city and country, summary, skills, languages, roles with their companies, places, dates and bullet points, projects (not their links), education, the publications you show on resumes and your facts about you. Scout's questions quote the posting's lines. **Test connection** sends one sentence of Scout's own. Nothing else is sent, and Scout keeps only the score, reasons and red flags it makes from the answers.

TypeSafe's [privacy policy](https://typesafe.ai/legal/privacy-policy) says it doesn't train or fine-tune models on what you send, that its service is hosted in the United States, and that it keeps data as long as it needs to provide the service, without a fixed period. Its [data processing agreement](https://typesafe.ai/legal/data-processing) covers transfers from the EU with standard contractual clauses. The key and the account are yours, with TypeSafe: read their terms before you choose Jev.

### No telemetry

Scout has no telemetry, analytics or usage ping. Nothing about you or your install goes to the Scout project: the only things that leave your computer are the ones on this page, for the services you set up yourself.

### MCP connector

The MCP connector lets you use Scout from Claude: in chats on claude.ai, in the Desktop and mobile apps, and in Claude's command-line app. Other apps that speak MCP, such as n8n, can use it too, once you add their callback address in Settings → MCP connector. It's off until you turn it on there. Then an app can use it once you've signed in to Scout and pressed **Allow**; while it's off, its addresses answer as if they didn't exist.

Another app gets the same as Claude, below, and whoever runs it decides what happens to it then: read its terms before you add it.

What Claude reads through it goes to Anthropic, under your own Claude account and its terms, as anything you put in a chat does:

- **Your profile,** without contact details, links or references: the same as a hosted AI provider gets for writing.
- **Postings:** what Manual job search finds for Claude (the searches are kept there, like your own), the postings you hand over, and the text of a posting Claude asks for by its link, fetched from your computer.
- **Your applications:** their details and status, the posting and the match, and the resume and cover letter as text. Never your private notes, or a letter's sender and signature.

Claude also writes through it: an application it wrote, saved as a Draft and checked like Scout's own AI's; the fit scores it gives postings; and an application's status. No tool deletes, archives or sends anything. With **Write it with Claude** in New application, the posting you pasted is kept for Claude to read for 14 days; Score and Write it with Claude open a new chat on claude.ai with a short prompt that names the posting by its ID, and nothing else.

Anthropic is the controller of what reaches it through your Claude account, and whoever runs another app you connect is the controller of what reaches it; the Scout project receives nothing from the connector. Scout keeps no tokens: the sign-in is signed with `DOSSIER_SECRET`, and **Disconnect all apps** ends it.

## GDPR and similar laws

What applies depends on who you run Scout for, and this isn't legal advice.

- **For your own job search:** the GDPR doesn't apply to processing for purely personal or household activities (Article 2(2)(c)), though no court has said yet whether a job search counts. Other privacy laws often exempt personal use too.
- **For other people**, such as a career coach, an agency or a service: you decide what happens to their data, so you're responsible for it under the GDPR. Among other things, that means a lawful basis for each use, telling them what this page says (who receives their data, for what, and for how long), a data processing agreement with a hosted AI provider, and safeguards when it processes the data outside the EEA. Resumes can reveal special category data, such as health or religion, and hold other people's details, such as references.

Self-hosting alone doesn't make a deployment compliant. Scout's code shows what it stores and sends. It can't tell you whether your provider, its terms or your account settings meet what you need.

When someone asks for their data, **Export** in Settings → Your data gives everything Scout keeps except task data and failed sign-ins, which expire on their own, and the mail from Gmail and the Google account, which belong to the mailbox: the mail is still in Gmail. Deleting an application or **Delete everything** removes data as described [above](#what-deleting-removes).
