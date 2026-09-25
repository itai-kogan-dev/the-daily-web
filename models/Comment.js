const mongoose = require('mongoose')

const commentSchema = new mongoose.Schema({
  article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  // guests type their own name, there's no account behind a comment.
  // maxlength here is the real check - the client side is just for show
  authorName: { type: String, required: true, trim: true, maxlength: 60 },
  body:       { type: String, required: true, trim: true, maxlength: 1000 }
}, { timestamps: true })

commentSchema.index({ article: 1, createdAt: -1 })   // newest comments of one article

module.exports = mongoose.model('Comment', commentSchema)
