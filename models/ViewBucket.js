const mongoose = require('mongoose')

// We count views per 5 minute window instead of saving a document per view.
// With thousands of readers that would be millions of documents - this way
// 847 views are one document and 847 cheap increments.
const BUCKET_MINUTES = 5

const viewBucketSchema = new mongoose.Schema({
  article:     { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  bucketStart: { type: Date, required: true },
  count:       { type: Number, default: 0 }
})

// unique, so "increment it or create it" still works when a lot of
// requests for the same article land at the same time
viewBucketSchema.index({ article: 1, bucketStart: 1 }, { unique: true })

// the viewCount rollup asks "which articles got a view since the last run",
// which the index above cannot answer - it starts with the article
viewBucketSchema.index({ bucketStart: 1 })

// rounds a timestamp down to the start of its window
viewBucketSchema.statics.getBucketStart = function (date = new Date()) {
  const ms = BUCKET_MINUTES * 60 * 1000
  return new Date(Math.floor(date.getTime() / ms) * ms)
}

module.exports = mongoose.model('ViewBucket', viewBucketSchema)
module.exports.BUCKET_MINUTES = BUCKET_MINUTES
