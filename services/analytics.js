const Article = require('../models/Article')
const ViewBucket = require('../models/ViewBucket')
require('../models/User')   // registers the model the update events populate from
const { escapeRegExp } = require('../utils/escapeRegExp')

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// How wide one point on the graph is. Picked from the length of the range so
// the graph always has a few hundred points at most - 30 days of 5 minute
// buckets would be 8640 points, more than the canvas has pixels.
const INTERVALS = {
  '5m': 5 * MINUTE,
  '1h': HOUR,
  '1d': DAY
}

const RANGES = {
  '24h': DAY,
  '7d':  7 * DAY,
  '30d': 30 * DAY,
  'all': Infinity
}

// How far either side of an update we look when comparing before and after.
const IMPACT_WINDOW = DAY

// a hand-picked interval that would draw more than this falls back to auto
const MAX_POINTS = 1500

function pickInterval(spanMs) {
  if (spanMs <= 2 * DAY) return '5m'
  if (spanMs <= 21 * DAY) return '1h'
  return '1d'
}

// The browser sends its time zone so that "a day" on the graph is the
// editor's day, not UTC's - in Israel a UTC day starts at 3am. Anything the
// Intl API does not recognise falls back to UTC instead of failing.
function resolveTimeZone(tz) {
  if (!tz) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

// how far ahead of UTC a time zone is at a given moment, DST included
function getZoneOffset(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric'
  }).formatToParts(date)
  const get = type => Number(parts.find(part => part.type === type).value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

// rounds down to the start of the point the time falls in, in local time
function findBinStart(date, step, timeZone) {
  const offset = getZoneOffset(date, timeZone)
  const local = Math.floor((date.getTime() + offset) / step) * step
  return local - getZoneOffset(new Date(local - offset), timeZone)
}

// Buckets only exist where there were views. Without the empty points the
// line would be drawn straight across a quiet night as if it were busy.
function buildEmptySeries(from, to, step, timeZone) {
  const series = new Map()
  let at = findBinStart(from, step, timeZone)
  while (at <= to.getTime()) {
    series.set(at, 0)
    // a step and a half always lands inside the next point, even on the
    // 23 and 25 hour days that DST makes
    at = findBinStart(new Date(at + step * 1.5), step, timeZone)
  }
  return series
}

// Mongo adds up to the hour (or reads the raw 5 minute buckets), we finish the
// grouping here. Days are the local ones, which $dateTrunc can only give us
// for one fixed zone per query - this way the rule lives in one place.
async function loadViews(articleId, from, to, interval) {
  const match = { article: articleId, bucketStart: { $gte: from, $lte: to } }

  if (interval === '5m') {
    const rows = await ViewBucket.find(match, { bucketStart: 1, count: 1 }).lean()
    return rows.map(row => ({ at: row.bucketStart, views: row.count }))
  }

  return ViewBucket.aggregate([
    { $match: match },
    { $group: { _id: { $dateTrunc: { date: '$bucketStart', unit: 'hour' } }, views: { $sum: '$count' } } },
    { $project: { _id: 0, at: '$_id', views: 1 } }
  ])
}

// The question the page exists to answer: did publishing an update bring
// readers back? For each update, views in the window after it against the
// same length of time before it. The window shrinks when the previous or next
// update is closer than a day, so one update's spike is never counted as
// another's "before".
function measureImpact(events, buckets, publishedAt, now) {
  return events.map((event, i) => {
    if (event.kind === 'first') return null

    const at = event.at.getTime()
    const prev = i > 0 ? events[i - 1].at.getTime() : publishedAt && publishedAt.getTime()
    if (!prev) return null
    const next = i + 1 < events.length ? events[i + 1].at.getTime() : now.getTime()
    const window = Math.min(IMPACT_WINDOW, at - prev, next - at)
    if (window < HOUR) return null   // too close together to say anything

    let before = 0
    let after = 0
    for (const bucket of buckets) {
      const t = bucket.bucketStart.getTime()
      if (t >= at - window && t < at) before += bucket.count
      else if (t >= at && t < at + window) after += bucket.count
    }

    return {
      windowHours: Math.round(window / HOUR * 10) / 10,
      before,
      after,
      change: before ? (after - before) / before : null
    }
  })
}

// Everything the graph needs for one article, shaped for Chart.js: points are
// { x, y } with x in ms, so the client hands them straight to a dataset.
async function findArticleViews(articleId, { range = 'all', interval, tz } = {}) {
  const article = await Article.findById(articleId)
    .populate('updateEvents.editor', 'displayName')
    .lean()
  if (!article) return null

  const now = new Date()
  const timeZone = resolveTimeZone(tz)
  const rangeMs = RANGES[range] ?? RANGES.all
  const born = article.publishedAt || article.createdAt
  const start = new Date(Math.max(born.getTime(), now.getTime() - rangeMs))
  const fits = INTERVALS[interval] && (now - start) / INTERVALS[interval] <= MAX_POINTS
  const chosen = fits ? interval : pickInterval(now - start)
  const step = INTERVALS[chosen]

  // from the start of the first point, not the exact moment: the bucket a
  // publication falls in started a few minutes before it
  const from = new Date(findBinStart(start, step, timeZone))

  const series = buildEmptySeries(from, now, step, timeZone)
  for (const row of await loadViews(article._id, from, now, chosen)) {
    const key = findBinStart(row.at, step, timeZone)
    if (series.has(key)) series.set(key, series.get(key) + row.views)
  }
  const points = [...series].map(([x, y]) => ({ x, y }))

  // publish() records the first publication as an event too. That one is the
  // start of the line, not an update, so it gets no before/after.
  const events = [...article.updateEvents]
    .sort((a, b) => a.at - b.at)
    .map((event, i) => ({
      at: event.at,
      editor: event.editor ? event.editor.displayName : null,
      kind: i === 0 && article.publishedAt && Math.abs(event.at - article.publishedAt) < MINUTE ? 'first' : 'update'
    }))

  // the raw 5 minute buckets around each update, one query for all of them
  let impact = events.map(() => null)
  if (events.some(event => event.kind === 'update')) {
    const near = await ViewBucket.find({
      article: article._id,
      bucketStart: {
        $gte: new Date(events[0].at.getTime() - IMPACT_WINDOW),
        $lt:  new Date(events[events.length - 1].at.getTime() + IMPACT_WINDOW)
      }
    }, { bucketStart: 1, count: 1 }).lean()
    impact = measureImpact(events, near, article.publishedAt, now)
  }

  let number = 0
  const updates = events.map((event, i) => ({
    at: event.at,
    editor: event.editor,
    kind: event.kind,
    label: event.kind === 'first' ? 'Published' : `Update ${++number}`,
    impact: impact[i]
  }))

  return {
    article: {
      id: article._id,
      title: (article.publishedContent || article.draftContent).title,
      isLive: article.isLive,
      publishedAt: article.publishedAt,
      viewCount: article.viewCount
    },
    range: RANGES[range] ? range : 'all',
    interval: chosen,
    intervalMs: step,
    timeZone,
    from,
    to: now,
    total: points.reduce((sum, point) => sum + point.y, 0),
    points,
    updates
  }
}


const PICKER_PAGE = 20

// The picker on the analytics page: live articles, most read first, a page
// at a time - the client asks for the next one as the list scrolls.
//
// _id is the last tiebreaker so equal view counts always come back in the
// same order; without it two articles on 0 views can swap between pages.
// The rollup can still move an article up between two page loads, so the
// client also skips ids it already has.
async function listArticles({ q = '', skip = 0, limit = PICKER_PAGE } = {}) {
  const filter = { isLive: true }
  const search = String(q).trim().slice(0, 100)
  if (search) filter['publishedContent.title'] = { $regex: escapeRegExp(search), $options: 'i' }

  const size = Math.min(Math.max(parseInt(limit, 10) || PICKER_PAGE, 1), 50)
  const from = Math.max(parseInt(skip, 10) || 0, 0)

  // one row more than the page, so we know whether there is another page
  // without a second query
  const [rows, total] = await Promise.all([
    Article.find(filter, { 'publishedContent.title': 1, viewCount: 1, publishedAt: 1, updateEvents: 1 })
      .sort({ viewCount: -1, publishedAt: -1, _id: -1 })
      .skip(from)
      .limit(size + 1)
      .lean(),
    Article.countDocuments(filter)
  ])

  return {
    articles: rows.slice(0, size).map(row => ({
      id: row._id,
      title: row.publishedContent.title,
      viewCount: row.viewCount,
      publishedAt: row.publishedAt,
      // the first event is the publication itself, not an update
      updates: Math.max(0, row.updateEvents.length - 1)
    })),
    hasMore: rows.length > size,
    total
  }
}

module.exports = { findArticleViews, listArticles }
