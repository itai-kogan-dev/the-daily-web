const ViewBucket = require('../models/ViewBucket')

// One request, one increment, into the 5 minute window it falls in. Not one
// document per pageview: docs/DECISIONS.md explains why that would be millions
// of documents and a very slow analytics graph.
//
// Article.viewCount is deliberately not touched here. It is a rollup of these
// buckets and has to be aggregated on a cadence, because that document stays
// hot for the life of the article while a bucket is replaced every 5 minutes.
// services/viewRollup.js does that.
async function increment(articleId) {
  const bucket = { article: articleId, bucketStart: ViewBucket.bucketFor() }

  try {
    await ViewBucket.updateOne(bucket, { $inc: { count: 1 } }, { upsert: true })
  } catch (err) {
    // The unique index on article + bucketStart is what makes the upsert safe,
    // but two requests arriving together can both miss and both try to create
    // the bucket. The loser gets a duplicate key error, and the fix is simply
    // to increment the document the winner just wrote.
    if (err.code !== 11000) throw err
    await ViewBucket.updateOne(bucket, { $inc: { count: 1 } })
  }
}

// Awaited, so a count is not lost if the process goes, but never allowed to
// escape: a few milliseconds of analytics is not worth turning an article a
// reader can see into an error page. The failure is logged, not swallowed.
async function countView(articleId) {
  try {
    await increment(articleId)
  } catch (err) {
    console.error('[views] could not count a view for', articleId, '-', err.message)
  }
}

module.exports = { countView }
