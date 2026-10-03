# API

Every endpoint in the system. This is the contract - write client code against
it before the server side exists, and change it here first if it needs to change.

Rule: pages return HTML, anything under `/api/` returns JSON. The error handler
and the auth middleware both use that to decide what to send back on failure.

Roles: `guest` (not logged in), `reporter`, `editor`.

## Public - `routes/public.js` (T1)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/` | guest | Feed page. Server rendered. |
| GET | `/article/:id` | guest | Article page. **Must be server rendered** - the full text has to be in the HTML with JS disabled. Counts a view. |
| GET | `/api/articles` | guest | Feed data. Query: `page`, `q`, `category`, `sort` (`date`\|`popular`). Returns published articles only. |
| GET | `/api/articles/:id/comments` | guest | Comments for one article. |
| POST | `/api/articles/:id/comments` | guest | Body `{ authorName, body }`. Rate limited to 3 per minute per device. |
| GET | `/api/weather` | guest | Sidebar widget (T4, `routes/weather.js`). Cached server side, up to 15 min old. Returns `{ city, temperature, feelsLike, high, low, humidity, wind, description, icon, fetchedAt, stale }`; `stale` is true when the weather service is down and this is the last known answer. `503` if there has never been one. |

## Auth - `routes/auth.js` (T2) - done

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/login` | guest | Login form. |
| POST | `/login` | guest | Body `{ username, password }`. Reporter goes to `/reporter`, editor to `/editor`. |
| POST | `/logout` | any | Destroys the session. |

## Reporter - `routes/reporter.js` (T2)

Whole file is behind `requireRole('reporter')`. A reporter only ever touches
their own articles - check `article.author` on every one of these.

| Method | Path | Notes |
|---|---|---|
| GET | `/reporter` | Own articles and their status. |
| GET | `/reporter/article/new` | New article form. |
| GET | `/reporter/article/:id` | Edit form. Shows `editorNote` if it was sent back. |
| POST | `/reporter/api/article` | Create. Starts at `in_progress`. |
| PATCH | `/reporter/api/article/:id` | Autosave. Writes `draftContent` only. Called every couple of seconds while typing - there is no save button. |
| POST | `/reporter/api/article/:id/submit` | To `pending_editor`. Goes through `articleWorkflow`. |

## Editor - `routes/editor.js` (T3)

Whole file is behind `requireRole('editor')`.

| Method | Path | Notes |
|---|---|---|
| GET | `/editor` | All articles, filterable by status. |
| GET | `/editor/article/:id` | Review. Has to show what is live now next to what is waiting. |
| GET | `/editor/analytics` | Impact analytics page. |
| PATCH | `/editor/api/article/:id` | Editor edits `draftContent` directly. |
| POST | `/editor/api/article/:id/publish` | Approve. Copies draft over published, sets `isLive`, adds an `updateEvent`. |
| POST | `/editor/api/article/:id/return` | Body `{ note }`. Sends it back for revision. |
| DELETE | `/editor/api/article/:id` | Delete. |
| DELETE | `/editor/api/article/:id/views` | Clear the view stats for one article. |

### Users (T2)

There is no sign up. Reporters and editors are staff, so an editor creates their
accounts - and an editor can create other editors. The first editor comes from
the seed script, otherwise nobody could log in to create anyone.

| Method | Path | Notes |
|---|---|---|
| GET | `/editor/users` | List all reporters and editors. |
| GET | `/editor/users/new` | Create form. |
| GET | `/editor/users/:id` | Edit form. |
| POST | `/editor/api/users` | Body `{ username, displayName, password, role }`. Password goes through `User.hashPassword`. |
| PATCH | `/editor/api/users/:id` | Update. Only re-hash the password if a new one was sent. |
| DELETE | `/editor/api/users/:id` | Delete. Refuse to delete the last editor, or nobody can log in. |

### Comment moderation (T3)

| Method | Path | Notes |
|---|---|---|
| PATCH | `/editor/api/comments/:id` | Edit a comment. |
| DELETE | `/editor/api/comments/:id` | Delete a comment. |

## Analytics - `routes/analytics.js` (T4)

Behind `requireRole('editor')`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/analytics/article/:id` | View counts over time plus the update points. Reads `ViewBucket`, returns something Chart.js can draw. |

## Errors

| Situation | Page route | `/api/` route |
|---|---|---|
| Not logged in | `302 -> /login` | `401 { error }` |
| Wrong role | `403` page | `403 { error }` |
| No such route | `404` page | `404 { error }` |
| Illegal state change | - | `400 { error }` |
| Crash | `500` page, generic message | `500 { error }` |

## CRUD coverage

The spec wants full CRUD on every model. Where each operation lives:

| Model | Create | Read | Update | Delete |
|---|---|---|---|---|
| User | `POST /editor/api/users` | `GET /editor/users` | `PATCH /editor/api/users/:id` | `DELETE /editor/api/users/:id` |
| Article | `POST /reporter/api/article` | `GET /api/articles` | `PATCH /reporter/api/article/:id` | `DELETE /editor/api/article/:id` |
| Comment | `POST /api/articles/:id/comments` | `GET /api/articles/:id/comments` | `PATCH /editor/api/comments/:id` | `DELETE /editor/api/comments/:id` |
| ViewBucket | on every article view | `GET /api/analytics/article/:id` | the increment on each view | `DELETE /editor/api/article/:id/views` |
