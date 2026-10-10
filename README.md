# The Daily Web

A news publishing site. Reporters write articles, an editor approves them, and
readers see what was approved. Built with Node.js, Express, EJS and MongoDB.

Three kinds of user:

- **Guest** - anyone not logged in. Reads the feed and articles, searches,
  filters, comments.
- **Reporter** - writes and edits their own articles and sends them to the
  editor. Writing autosaves; there is no save button.
- **Editor** - reviews what reporters send, publishes it or sends it back with
  a note, deletes articles and comments, manages staff accounts, and sees how
  each update affected readership.

## Quick start

You need **Node.js 20.19 or newer** and a **MongoDB** database (Atlas or local).

```bash
npm install
cp .env.example .env     # then fill it in - see Configuration
npm run seed             # demo data - WIPES the database in MONGODB_URI
npm run dev              # http://localhost:3000, restarts when a file changes
```

> **`npm run seed` deletes everything in the database it points at** before
> filling it. Point `MONGODB_URI` at your own database name (for example
> `.../thedailyweb_yourname`) unless the whole team agrees to reset the shared
> one.

Log in with any of these, using `SEED_PASSWORD` from your `.env`:

| Username | Role |
|---|---|
| `editor` | Editor |
| `itai`, `nadav`, `idan`, `yuval` | Reporter |

There is no sign-up page. Reporters and editors are staff, so an editor creates
their accounts; the seed creates the first editor.

## Configuration

All settings live in `.env`, which is gitignored. `.env.example` lists them.

| Variable | Required | What it is |
|---|---|---|
| `MONGODB_URI` | yes | Connection string, including the database name. |
| `SESSION_SECRET` | yes | Any long random string. Signs the login cookie. |
| `SEED_PASSWORD` | for seeding | Password given to every seeded user. |
| `PORT` | no | Defaults to `3000`. |
| `LOG_DIR` | no | Where log files go. Defaults to `logs/`. |
| `LOG_KEEP_DAYS` | no | Log files older than this are deleted. Defaults to `14`. |

The weather widget needs no API key.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Runs the server and restarts it on every file change. |
| `npm start` | Runs the server once, as in production. |
| `npm run seed` | Replaces the database with 500 articles, comments, view history and the users above. |

## How it is built

Pages are HTML rendered on the server with EJS; small scripts in `public/js/`
add infinite scroll, autosave and the like. Paths under `/api/` return JSON,
every other path returns a page. There is no build step and no frontend
framework.

```
app.js            starts everything: middleware order, routers, background job
config/           database connection, log file
middleware/       auth + roles, request log, error handler, comment rate limit
routes/           one file per area - maps URLs to handlers
controllers/      request handlers - every route calls one of these
services/         logic: article workflow, view counting and rollup,
                  analytics, weather, image storage
models/           Mongoose schemas: User, Article, Comment, ViewBucket,
                  EditorDraft
utils/            small helpers shared by controllers and services
views/            EJS pages and partials
public/           browser JS and CSS
scripts/seed.js   demo data
docs/             API.md and DECISIONS.md
```

Things worth knowing before you change anything - each is explained in
[`docs/DECISIONS.md`](docs/DECISIONS.md):

- **Article states.** `in_progress -> pending_editor -> published` or
  `needs_revision`. Every status change goes through
  `services/articleWorkflow.js`, which rejects illegal moves.
- **Two copies of the content.** Readers see `publishedContent`; reporters edit
  `draftContent`. Approving copies one over the other, so a live article stays
  unchanged while its update waits for approval.
- **Views are counted in 5 minute buckets** (`ViewBucket`), not one document per
  view. `Article.viewCount`, used to sort by popularity, is recalculated from
  the buckets every 5 minutes.
- **Sessions are stored in MongoDB**, so restarting the server logs no one out.
- **Comments are limited to 3 a minute** per browser session.
- **The article page is fully server rendered**, so its text is there with
  JavaScript turned off.

Every endpoint, with who may call it and what it returns, is in
[`docs/API.md`](docs/API.md).

## Logs

The server logs one line per request, plus database events, errors and
background jobs. Every line goes to the terminal and to a file per day:

```
logs/app-2026-10-09.log

2026-10-09T18:25:03.412+03:00 INFO  [http] a1b2c3 GET /article/66f... 200 34ms guest
2026-10-09T18:25:07.090+03:00 ERROR [error] 9f8e7d 500 GET /editor - Something broke
```

The six characters after `[http]` are the request id. It is also sent back in
the `X-Request-Id` header, and an error logged for that request carries the
same id, so `grep 9f8e7d logs/*.log` finds everything about one request.

To watch today's log as it is written:

```bash
tail -f logs/app-$(date +%F).log
```

## Troubleshooting

**`[fatal] could not start` after about 10 seconds.** The server cannot reach
MongoDB. With Atlas, check that your current IP is allowed under *Network
Access* - a new network (a university, a phone hotspot) is a new IP.

**The weather box asks for location, or says it can't find you.** Allow
location for the site in the browser. On macOS, the browser also needs
*System Settings > Privacy & Security > Location Services*.

**"Most read" doesn't change right after reading an article.** Popularity is
recalculated every 5 minutes. The analytics graph shows the view at once.

**A 4th comment is refused.** The limit is 3 a minute per browser; wait, or
use a private window.

## Team

Four tracks, one branch and pull request per feature, reviewed by someone else
before merging.

| Track | Owner | Area |
|---|---|---|
| T1 | Nadav | Public site: feed, search, article page, comments |
| T2 | Itai | Reporter side, accounts, project skeleton |
| T3 | Idan | Editor side: queue, review, publish, moderation |
| T4 | Yuval | View counting, analytics, weather, logging, error handling, README |
