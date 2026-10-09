# Decisions

Choices that aren't obvious from the code, and why we made them. Four people
working at different hours can't ask each other - read this instead.

## Article states

We use English values with a label map for display. The spec names the four
states in Hebrew, so here is the mapping:

| Our value | Spec |
|---|---|
| `in_progress` | בהכנה |
| `pending_editor` | ממתינה לאישור עורך |
| `published` | פורסמה |
| `needs_revision` | הוחזרה לתיקונים |

## `published -> in_progress` is not in the spec's list

The spec lists the legal transitions and says any other one is forbidden. Its
list has nothing leaving `published`, but it also says that editing an article
which is already published sends the new version through the same approval
process - and that process starts at `in_progress`. So we read that sentence as
the missing transition. It is the only place we go past the literal text.

## `status` and `isLive` are two fields

`status` says where the working version is in the approval process. `isLive`
says whether readers can see anything at all. They are separate questions: an
article that is live with an update waiting for approval is `isLive: true` and
`pending_editor` at the same time, and it has to stay in the feed. One combined
field would make a live article disappear the moment someone edited it.

The feed queries on `isLive`, never on `status`.

## Two content fields instead of one

`publishedContent` is what readers get, `draftContent` is what the reporter
edits. Approving copies draft over published. That is what keeps the approved
version on the site while an update is being written and reviewed.

Anything a reporter can edit lives inside those objects - including the title
and the category. If the title sat on the article itself there would be one
copy, and renaming it would change the live site immediately.

## Views are counted in 5 minute buckets

One document per article per 5 minute window, incremented, instead of one
document per pageview. The spec assumes thousands of readers at once, which
would mean millions of documents and a very slow analytics graph. We lose the
exact second of each view, which nothing needs.

`Article.viewCount` is a rollup of those buckets, not a second counter. The feed
sorts by popularity and needs an indexed field to do it, which an aggregation
over buckets cannot give us.

It has to be updated on a cadence rather than once per view. A bucket only stays
current for 5 minutes, so writes to it move on; `viewCount` is one document per
article that would stay hot for the life of the article, and Mongo locks per
document. The seed already does it the right way - it aggregates the buckets at
the end instead of counting as it inserts.

The rollup belongs to T4, next to the analytics page: a job aggregates the
buckets into `Article.viewCount` every 5 minutes, so `?sort=popular` lags the
live counts by at most one window. Until that job exists, `viewCount` is the
seed value and popularity does not move - that is a missing job, not a missing
increment.

## Guest is a role, but never stored

The spec has three user types. Guest has no username and no password, so there
is nothing to put in the database - anyone without a session is treated as a
guest. All three are named in `ROLES`; only reporter and editor are in the
schema's enum.

`currentUser()` returns a guest object rather than `null` so every request has a
user and permission checks look the same everywhere.

## Comment rate limiting counts in the session, not by IP

The spec allows 3 comments a minute "from the same device", so there is no field
for it on `Comment` - the count lives in the session. An IP is a network, and a
dorm or an office would share the three between them; a session cookie is per
browser, which is closer to a device.

`saveUninitialized` is false, so a guest browsing creates no session. Writing the
count is what creates one, so only people who comment cost us a row.

See `middleware/rateLimit.js`.

## Weather comes from Open-Meteo, cached on the server

Open-Meteo instead of OpenWeather because it needs no API key: no secret to
pass between four laptops, nothing to leak, and the widget works on a fresh
clone.

The widget shows the reader's own weather when the browser lets us have their
location, and the default place from `.env` (`WEATHER_CITY`, `WEATHER_LAT`,
`WEATHER_LON` - Tel Aviv) otherwise. The default shows first and the reader's
weather replaces it, so nothing waits on the permission prompt and saying no
just leaves the default. The location is rounded to a tenth of a degree (about
11 km) in the browser before it is sent: that is plenty for weather, it is the
most precise location we ever see, and it lets a whole city share one cache
entry. It is remembered for the visit, so the next page skips the lookup.

Every page with a sidebar asks for the weather, so the server caches the answer
per place for 15 minutes - the limit the spec allows - and the weather service
hears from us about 4 times an hour per place whatever the traffic. The cache
holds at most 500 places, oldest out first, so readers from everywhere cannot
grow it without limit. When the cache is cold and many
readers arrive at once, they all wait for the same single request instead of
sending one each. If the service is down we keep showing the last answer,
labelled as such, rather than an error. A 5 second timeout means a hung weather
service cannot hang the sidebar.

The widget is filled by the browser, not rendered into the page, so a slow
weather service never delays the article itself.

## Interface language is English

The spec never asks for Hebrew - its only mention of "languages" is about
programming languages. English means no RTL layout work, which is a real saving
on a two week deadline. The four state names still map to the spec's Hebrew
ones, see the table above.

## Sessions, not JWT

The spec asks for username and password login and says a logged in user must
stay logged in after a server restart. It does not say how.

We use `express-session` with `connect-mongo`, so sessions live in MongoDB. The
default in-memory store would lose every login on restart, which is exactly what
that requirement is testing. JWT would also survive a restart, but logging out
does not really work with it - a token stays valid until it expires unless you
keep a blocklist on the server, which makes it stateful anyway.

## No sign up page - editors create accounts

The spec never mentions registration, and it shouldn't: reporters and editors
are staff. A public sign up page would let anyone register as a reporter and
publish to the news site.

So accounts are created in two places:

1. `npm run seed` creates the first editor, plus a few reporters to work with.
2. After that an editor creates accounts at `/editor/users/new`, and can create
   both reporters and other editors.

The seed has to create that first editor, otherwise nobody could log in to
create anyone - the usual bootstrap admin. Guests need no account at all; they
read and comment without one.

This is also what gives the User model its full CRUD, which the spec asks for on
every model. `docs/API.md` has the coverage table.

One thing to handle when building it: refuse to delete the last editor, or
nobody can log in afterwards.

## The analytics graph

The editor's question is "did publishing an update bring readers back?", so
the page answers it twice: a marker on the graph at every update, and a table
with the views in the window after each update against the same length of time
before it. The window is a day, cut shorter when the previous or next update is
closer - otherwise one update's spike would be counted as the next one's
"before". The first publication is not an update and gets no comparison.

The width of a point is picked from the range - 5 minutes up to 2 days, hours
up to 3 weeks, days after that - so the graph never has more than a few hundred
points. Quiet periods are filled with zeros on the server: buckets only exist
where there were views, and without the zeros the line would be drawn straight
across a night with nobody reading.

The browser sends its time zone. A daily point is a local day; in Israel a UTC
day would start at 3am. Mongo groups the buckets by hour and the server makes
the local days from those, so DST days (23 and 25 hours) come out right.

Chart.js draws the graph from a CDN, the same way the site gets no build step.
It has no built-in event marker, so the dashed lines are a twenty line plugin
in `public/js/analytics.js` rather than another dependency.

