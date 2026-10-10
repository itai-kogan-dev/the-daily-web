const ViewBucket = require('../models/ViewBucket')

// One increment per view into the article's 5-minute bucket, not a document
// per view (see docs/DECISIONS.md). viewRollup.js keeps Article.viewCount in step.
async function increment(articleId) {
  const bucket = { article: articleId, bucketStart: ViewBucket.getBucketStart() }

  try {
    await ViewBucket.updateOne(bucket, { $inc: { count: 1 } }, { upsert: true })
  } catch (err) {
    // two views at once can both try to create the bucket - the loser hits the
    // unique index, and simply increments the bucket the winner created
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
