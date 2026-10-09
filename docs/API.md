# API

Every endpoint in the system.

Rule: pages return HTML, anything under `/api/` returns JSON. The error handler
and the auth middleware both use that to decide what to send back on failure.

Roles: `guest` (not logged in), `reporter`, `editor`.

## Public - `routes/public.js`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/` | guest | Feed page. Server rendered. |
| GET | `/article/:id` | guest | Article page. **Must be server rendered** - the full text has to be in the HTML with JS disabled. Counts a view. |
| GET | `/api/articles` | guest | Feed data. Query: `page`, `q`, `category`, `sort` (`date`\|`popular`). Returns live articles only - approved at least once, even while an update waits for approval. |
| GET | `/api/articles/ids` | guest | Same filters as `/api/articles`, ids only. Used by the feed's unread count. |
| GET | `/api/articles/:id/comments` | guest | Comments for one article. |
| POST | `/api/articles/:id/comments` | guest | Body `{ authorName, body }`. Rate limited to 3 per minute per device. |
| GET | `/api/weather` | guest | Sidebar widget (`routes/weather.js`). Query: `lat` and `lon`, both required - there is no default place; missing or off the globe is a `400`. Cached server side per place, up to 15 min old; the `Cache-Control` max-age is whatever is left of those 15 minutes, so with the browser's copy it is never older either. Returns `{ city, temperature, feelsLike, high, low, humidity, wind, description, icon, fetchedAt, stale }`; `city` is the place name from OpenStreetMap, or `null` if it could not be found. `stale` is true when the weather service is down and this is the last known answer. `503` if there has never been one. |

## Auth - `routes/auth.js`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/login` | guest | Login form. |
| POST | `/login` | guest | Body `{ username, password }`. Reporter goes to `/reporter`, editor to `/editor`. The session id is renewed on success. After 20 failed tries in 10 minutes the form answers `429`; wrong user and wrong password always get the same message. |
| POST | `/logout` | any | Destroys the session. |

## Reporter - `routes/reporter.js`

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
| POST | `/reporter/api/image` | Picture upload. Raw image bytes as the body (`Content-Type` is the image type, name in `X-Image-Name`), max 2 MB. Returns `{ url }` (`/images/<id>`), which the next autosave carries like any other field. |

## Editor - `routes/editor.js`

Whole file is behind `requireRole('editor')`.

| Method | Path | Notes |
|---|---|---|
| GET | `/editor` | All articles, filterable by status. |
| GET | `/editor/article/:id` | Review. Has to show what is live now next to what is waiting. |
| GET | `/editor/analytics` | Impact analytics page. |
| PATCH | `/editor/api/article/:id` | Editor autosave. Writes the editor's private `EditorDraft` only - the reporter's `draftContent` is untouched until publish or return folds it over. |
| POST | `/editor/api/article/:id/publish` | Approve. Folds the `EditorDraft` over the draft if there is one, copies draft over published, sets `isLive`, adds an `updateEvent`, deletes the `EditorDraft`. |
| POST | `/editor/api/article/:id/return` | Body `{ note }`. Sends it back for revision, folding the `EditorDraft` over the draft first. |
| POST | `/editor/api/image` | Picture upload, same shape as the reporter's. The picker puts the returned path in the form; the next autosave carries it. |
| DELETE | `/editor/api/article/:id` | Delete. Removes the article with its comments, view buckets and editor draft. |
| DELETE | `/editor/api/article/:id/views` | Clear the view stats for one article. Buckets go, `viewCount` returns to 0, the article stays. |

### Users

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

### Comment moderation

| Method | Path | Notes |
|---|---|---|
| PATCH | `/editor/api/comments/:id` | Edit a comment. |
| DELETE | `/editor/api/comments/:id` | Delete a comment. |

## Images - `routes/images.js`

Pictures live in MongoDB (GridFS), so every checkout sees the same ones. No
SVG: it can carry a script, and uploads are served from our own origin.

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/images/:id` | guest | Streams the stored bytes with a long cache header. Bad id is `404`, which goes through the error handler like everything else. |

## Analytics - `routes/analytics.js`

Behind `requireRole('editor')`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/analytics/articles` | Live articles for the picker, most read first, one page at a time. Query: `q` (title contains), `skip`, `limit` (default 20, max 50). Returns `{ articles, hasMore, total }`. |
| GET | `/api/analytics/article/:id` | View counts over time plus the update points. Reads `ViewBucket`, returns something Chart.js can draw. Query: `range` (`24h`\|`7d`\|`30d`\|`all`), `interval` (`5m`\|`1h`\|`1d`, picked from the range if left out), `tz` (browser time zone, so a day on the graph is a local day). |

`/api/analytics/article/:id` returns:

```js
{
  article:  { id, title, isLive, publishedAt, viewCount },
  range, interval, intervalMs, timeZone, from, to,
  total,                       // views inside the range
  points:  [{ x, y }],         // x = start of the point in ms, y = views. Zero filled.
  updates: [{ at, editor, kind, label, impact }]
  // kind 'first' is the first publication, 'update' is every approval after it.
  // impact = { windowHours, before, after, change } or null when it can't be measured
}
```

## Errors

| Situation | Page route | `/api/` route |
|---|---|---|
| Not logged in | `302 -> /login` | `401 { error }` |
| Wrong role | `403` page | `403 { error }` |
| No such route | `404` page | `404 { error }` |
| Illegal state change | - | `400 { error }` |
| Too many comments (`POST /api/articles/:id/comments`) | - | `429 { error }` with a `Retry-After` header |
| Too many login tries (`POST /login`) | `429` page | - |
| Crash | `500` page, generic message | `500 { error }` |

## CRUD coverage

The spec wants full CRUD on every model. Where each operation lives:

| Model | Create | Read | Update | Delete |
|---|---|---|---|---|
| User | `POST /editor/api/users` | `GET /editor/users` | `PATCH /editor/api/users/:id` | `DELETE /editor/api/users/:id` |
| Article | `POST /reporter/api/article` | `GET /api/articles` | `PATCH /reporter/api/article/:id` | `DELETE /editor/api/article/:id` |
| Comment | `POST /api/articles/:id/comments` | `GET /api/articles/:id/comments` | `PATCH /editor/api/comments/:id` | `DELETE /editor/api/comments/:id` |
| ViewBucket | on every article view | `GET /api/analytics/article/:id` | the increment on each view | `DELETE /editor/api/article/:id/views` |
