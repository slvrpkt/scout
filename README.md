<p align="center">
  <img src="docs/images/hero.png" alt="Scout: your agentic job search companion. Finds the jobs, scores them against your profile, and drafts tailored resumes checked against common ATS criteria. It never applies for you." width="100%">
</p>

<h1 align="center">Scout</h1>

<p align="center">
  <strong>Your agentic job search companion.</strong><br>
  It searches for jobs on a schedule, scores each one against your profile, and drafts a tailored resume and cover letter for the ones worth your time. You review everything and decide what to send.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white">
  <img alt="Runs on your computer" src="https://img.shields.io/badge/runs-on%20your%20own%20computer-2f6b4f">
  <img alt="Free" src="https://img.shields.io/badge/price-free-b08d3c">
</p>

---

## Why Scout

Job hunting is exhausting. You read the same kinds of postings over and over, rewrite your resume for each one, and wonder whether an applicant tracking system (ATS) will even read it properly. Scout takes on the repetitive parts, so you can spend your energy on the jobs and the people that matter.

I built Scout for my own job search and I'm sharing it for free, for **anyone looking for work**. If it helps you land your next role, that's all I hoped for. Use it as it is, change it, make it yours.

> **Scout never applies for you.** Its agents search, read and score postings and prepare drafts. Nothing is sent, submitted or applied for until you do it yourself.

> **Please double-check what the AI writes.** Scout uses AI models (large language models), and they can be wrong, even confidently, and can occasionally invent a detail. Scout tells the AI to use only facts from your profile, and checks for invented ones, but no check is perfect. Read every resume and cover letter before you send it, and only send what's true for you.

## What it does

Ten things Scout does, and [many more](#and-much-more):

**Find**

1. **Agentic job search.** Save up to 20 searches. Each has a job title, up to 5 alternative titles (like "TPM" or "AI Program Manager"), up to 10 locations or "Anywhere", and filters for work mode, seniority, job type and minimum salary. Or follow up to 10 companies: Scout looks for the title at each one across your whole country and keeps only their jobs. The agent runs your searches at the times you pick, skips what you've already seen, and keeps the best matches for you to review, with filters by company and location.
2. **Manual job search.** Search postings yourself through JSearch (Google for Jobs, which covers LinkedIn, Indeed, Glassdoor and many company sites), with the same filters and an optional company, and start an application from any result in one click.

**Score**

3. **Fit scoring that's yours.** Every posting gets a score out of 100. The AI judges how well your skills and experience fit; Scout adds work style, pay and distance from your ZIP code by your own rules, plus a bonus for applying to fresh postings early. You see the reasons, the red flags and exactly how the score was made.
4. **Checked against common ATS criteria (US).** Each tailored resume gets a letter grade against the things applicant tracking systems commonly look at: a readable format, the posting's keywords and hard skills, years of experience, degrees and contact details. Below an A, Scout rewrites it toward one, using only what your profile backs. It's an estimate: Scout doesn't have access to any employer's ATS, and every ATS works a little differently.

**Write**

5. **Resumes tailored to the full job description.** Scout reads the whole posting and your whole career history, then writes a resume for that job: what's relevant first, scope and ownership spelled out, results over duties, and nothing invented.
6. **Your page limit, exactly.** Ask for 2 or 3 pages and you get 2 or 3 pages, in both the PDF and the Word file. Older jobs are condensed first and recent ones last, and every point that's shortened is rewritten shorter, never just cut off.
7. **A base resume at any length.** Full, two pages or three, in a dozen themes, downloaded as PDF or Word.
8. **Cover letters and a refining chat.** A cover letter in the tone you choose, and a chat to change anything ("make the summary shorter", "lead with leadership").

**Track**

9. **Your job application log.** A board from draft to offer, a dashboard with your funnel and weekly activity, an archive, and a warning when you're about to apply to the same job twice.
10. **Your data, on your computer.** Scout runs on your own machine with your own database. You choose the AI provider and bring your own keys, and you can export everything at any time.

### And much more

Read your existing resume (PDF or Word) to fill in your profile · Gmail and Google Calendar integration (optional) · startups that are hiring, from Hacker News and YC · a Claude connector (MCP) · cost estimates and spending limits for your API keys · resume themes and a theme builder · application history and undo · dark mode · and plenty of small touches.

## Screenshots

<sub>All screenshots use made-up demo data (Jane Doe and her companies are fictional).</sub>

**The agentic job search.** Scored postings with the reasons behind each score, fresh postings first.

![The agentic job search, with scored postings and the selected one's details](docs/images/agent.png)

**An agent search.** A job title, alternative titles, locations, filters and what to skip.

![A saved agent search with alternative titles](docs/images/agent-search.png)

**A tailored application.** The resume written for this job, its grade against common ATS criteria, suggestions, and the chat to refine it.

![An application with its tailored resume, ATS score and refining chat](docs/images/application.png)

<table>
  <tr>
    <td width="50%"><strong>Manual job search with filters</strong><br><img src="docs/images/find-jobs.png" alt="Manual job search"></td>
    <td width="50%"><strong>Scoring by your own rules</strong><br><img src="docs/images/scoring.png" alt="Scoring settings"></td>
  </tr>
  <tr>
    <td><strong>The base resume, at your page limit</strong><br><img src="docs/images/resume.png" alt="The base resume"></td>
    <td><strong>Your funnel on the dashboard</strong><br><img src="docs/images/dashboard.png" alt="The dashboard funnel"></td>
  </tr>
  <tr>
    <td><strong>The job application log</strong><br><img src="docs/images/applications.png" alt="The application board"></td>
    <td><strong>Your profile</strong><br><img src="docs/images/profile.png" alt="The profile"></td>
  </tr>
</table>

## Getting started

Scout runs on your own computer, for one person. You'll need about 15 minutes and two API keys.

### 1. Get your keys

- **An AI model.** Scout works with **Anthropic (Claude)**, OpenAI or any OpenAI-compatible service, Mistral, or a free local model through Ollama or LM Studio. For Claude, create a key in the [Anthropic Console](https://console.anthropic.com/). A small, inexpensive model such as Claude Haiku is enough for everyday use, and Scout shows what you're spending.
- **A job search key (JSearch).** Get one from [OpenWeb Ninja](https://www.openwebninja.com/api/jsearch) or [RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch). There's a free tier to start with; pay-as-you-go after that.

You paste both keys into Scout's Settings once it's running. They're stored encrypted in your own database and only ever sent to the provider they belong to.

> **Set a hard spending limit on every key before you add it.** Scout's agents run on their own. If something goes wrong, such as an agent repeating the same searches, a key with no billing limit could run up an unexpectedly large bill. Set a monthly limit with each provider (in the Anthropic Console under Settings → Limits; for JSearch, a plan with a fixed number of requests rather than open-ended pay-as-you-go). Scout also starts with its own daily, weekly and monthly limits switched on (JSearch: $0.30 a day, $1.50 a week, $6 a month; a hosted AI model: $1, $5 and $15), which pause it when they're reached. You can change them in Settings → Estimated cost. Keys with no billing limit are strongly discouraged.

### 2. Install and run

You'll need [Node.js 24](https://nodejs.org/), [PostgreSQL 18](https://www.postgresql.org/download/) and [Git](https://git-scm.com/).

```bash
git clone https://github.com/slvrpkt/scout.git
cd scout
corepack enable
yarn install
cp .env.example .env
```

Open `.env` in a text editor and fill in three lines:

- `DATABASE_URL`: your PostgreSQL database, for example `postgresql://postgres:yourpassword@localhost:5432/scout`.
- `DOSSIER_SECRET`: at least 32 random characters, for example the output of `openssl rand -base64 32`.
- `DOSSIER_PASSWORD`: run `yarn hash-password`, type the password you want to sign in with, and paste the line it prints (it starts with `argon2id:`).

Then set up the database and start Scout:

```bash
yarn prisma migrate deploy --config prisma7.config.ts
yarn prisma db seed --config prisma7.config.ts
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with your password.

For everyday use, a production build is much faster:

```bash
yarn build
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/
cd .next/standalone && set -a && . ../../.env && set +a && HOSTNAME=localhost PORT=3000 node server.js
```

### Run it with Docker instead (optional)

With [Docker](https://docs.docker.com/get-docker/), from the cloned folder:

```bash
docker compose -f compose.production.yml build
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
echo "DOSSIER_SECRET=$(openssl rand -base64 32)" >> .env
docker run --rm -it scout:latest hash-password   # add the line it prints to .env as DOSSIER_PASSWORD=…
docker compose -f compose.production.yml up -d
```

Scout is then at [http://localhost:3000](http://localhost:3000), with its database in a Docker volume.

### 3. Set it up in the app

1. **Settings → AI provider:** choose your provider and paste your key.
2. **Settings → Job search:** choose JSearch and paste your key.
3. **Profile:** read in your current resume (PDF or Word), or fill it in by hand. The more complete it is, the better every resume and score.
4. **Settings → Scoring:** your ZIP code, how far you'll travel, your pay range and what matters to you.
5. **Settings → Job agent:** add a search, pick the times it runs, and switch it on. Results appear under **Agentic job search**.

### Hosting it yourself (entirely optional)

Scout is made to run on your own computer, and that's all most people need. If you'd like it reachable from anywhere, you can put it on a small server of your own, for example an AWS EC2 or Lightsail instance with Docker Compose and a reverse proxy such as Caddy for HTTPS. Give it at least 2 vCPUs and 2 GB of memory, keep your `.env` private, and use a strong password. Scout also supports signing in through Amazon Cognito (`DOSSIER_AUTH=cognito`, see `.env.example`).

### Updating

From your Scout folder: `git pull`, then `yarn install`, `yarn prisma migrate deploy --config prisma7.config.ts` and start it again (or `docker compose -f compose.production.yml build` and `up -d`). Settings → About can check for new versions of Scout; that check is off until you switch it on.

### Troubleshooting

Something not working? Search the [issues](https://github.com/slvrpkt/scout/issues), or open a new one with what you did and what you saw. Please leave your keys, password and personal details out of it.

## Privacy

Your profile, documents and applications stay in your own database. What leaves your computer is only what you turn on: the text your AI provider needs to write or score, your searches to JSearch, and, if you connect them, Google and the Claude connector. Scout has no telemetry and sends nothing to me. [PRIVACY.md](PRIVACY.md) has the details.

## Use at your own risk

Scout is a personal project, shared in the hope that it helps, and given as it is, with no warranty or guarantee of any kind. AI models can make mistakes, misread a posting or occasionally invent a fact; grades against ATS criteria are estimates, not a promise of how any employer's system will treat your resume; and job boards can list jobs that are out of date or not what they seem. Please:

- **Review every resume and cover letter** before you send it, and only send what's true for you.
- **Check the job itself** with the employer before sharing personal details.
- **Keep an eye on your API spending.** Settings → Estimated cost shows what Scout thinks it has spent, and its limits pause it when they're reached. Those amounts are **estimates**, worked out from each provider's published prices as of the date shown on that page; prices change and providers bill differently. Always check your real usage and charges in your account with each provider. Scout isn't a billing system.

You're always the one who decides what gets sent, and responsible for it. [LICENSE](LICENSE) has the full terms.

## Credits

Scout stands on the shoulders of others, with thanks:

- **[Dossier](https://github.com/AienTech/dossier) by AienTech.** Scout began as Dossier, a self-hosted job application tracker and resume writer, and is built on top of it. The profile, resume themes, application tracking, PDF rendering and much of the foundation are Dossier's work. Scout adds the agentic job search, fit scoring, ATS-criteria checks, page-exact tailored resumes and more.
- **avinashbatchala's fork**, whose job agent and scoring ideas Scout's agent was adapted from.
- **The humanizer skill by Siqi Chen**, which Scout's writing guidance is adapted from.
- **Built with [Claude Code](https://claude.com/claude-code)** and its skills, including the floorplan and Claude API skills.
- **Open-source software:** [Next.js](https://nextjs.org/), [React](https://react.dev/), [Prisma](https://www.prisma.io/), [PostgreSQL](https://www.postgresql.org/), [Playwright](https://playwright.dev/), [docx](https://docx.js.org/), [pdf-lib](https://pdf-lib.js.org/), [Tailwind CSS](https://tailwindcss.com/) and many more, plus open fonts from Google Fonts and IBM Plex.
- **Data:** ZIP code locations from the US Census Bureau (public domain). Job listings come through [JSearch by OpenWeb Ninja](https://www.openwebninja.com/api/jsearch).

## Contributing

Ideas, bug reports and pull requests are welcome through [GitHub](https://github.com/slvrpkt/scout/issues). [CONTRIBUTING.md](CONTRIBUTING.md) and [DEVELOPMENT.md](DEVELOPMENT.md) explain how the code is organized and how to run the tests.

## License

Scout is free software under the [GNU Affero General Public License v3.0](LICENSE), the same license as Dossier, which it's built on. You may use, study, change and share it, for free. If you share a changed version, or run one for other people over a network, you must offer them its source code under the same license. See [NOTICE.md](NOTICE.md) for the copyright and the changes made.
