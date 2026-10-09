const Article = require('../models/Article')
const ViewBucket = require('../models/ViewBucket')

const INTERVAL_MS = ViewBucket.BUCKET_MINUTES * 60 * 1000

// Article.viewCount is a rollup of the buckets, so the feed can sort by
// popularity on an index. docs/DECISIONS.md explains why it is not incremented
// per view: one document per article would stay hot for its whole life.
//
// Each run only looks at articles that got a view since the previous run, so
// the cost follows how many articles are being read right now, not how many
// articles exist. The first run after a start has nothing to compare against
// and does all of them, which also repairs anything missed while we were down.
let lastRunAt = null
let running = false

async function rollup() {
  const startedAt = new Date()

  // bucketFor rounds down, so a view that lands in the current window just
  // after the last run started is still picked up - its bucket started earlier
  const changedSince = lastRunAt ? ViewBucket.bucketFor(lastRunAt) : null
  const match = changedSince ? { bucketStart: { $gte: changedSince } } : {}

  const articleIds = await ViewBucket.distinct('article', match)
  if (!articleIds.length) {
    lastRunAt = startedAt
    return 0
  }

  // the whole history of each article, not just the new buckets - a plain
  // $set of the total means a run that happens twice changes nothing
  const totals = await ViewBucket.aggregate([
    { $match: { article: { $in: articleIds } } },
    { $group: { _id: '$article', total: { $sum: '$count' } } }
  ])

  // the $ne filter skips articles whose number did not move, so they cost a
  // read and no write
  const result = await Article.bulkWrite(totals.map(row => ({
    updateOne: {
      filter: { _id: row._id, viewCount: { $ne: row.total } },
      update: { $set: { viewCount: row.total } },
      // a view is not an edit - updatedAt is what the queues sort and date by
      timestamps: false
    }
  })), { ordered: false })

  lastRunAt = startedAt
  return result.modifiedCount
}

// A slow run must not overlap the next one, and a failed run must not stop
// the timer. lastRunAt only moves on success, so the next run covers the gap.
async function runOnce() {
  if (running) return
  running = true
  try {
    const updated = await rollup()
    if (updated) console.log(`[views] rollup updated ${updated} articles`)
  } catch (err) {
    console.error('[views] rollup failed -', err.message)
  } finally {
    running = false
  }
}

// One window per run: viewCount is never more than one bucket behind.
// Running it on more than one server is safe - every run writes totals, not
// increments, so two of them land on the same number.
function startViewRollup() {
  runOnce()
  const timer = setInterval(runOnce, INTERVAL_MS)
  timer.unref()   // never the reason the process stays alive
  return timer
}

module.exports = { startViewRollup, rollup }
