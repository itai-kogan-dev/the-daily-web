const mongoose = require('mongoose')
const { CATEGORIES } = require('./Article')

// The editor's private working copy. Autosave writes here only - the
// reporter's draftContent is left alone until publish or send-back folds
// this over it. One row per article: whichever editor picks it up carries
// on from the same in-progress text.
const editorContentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  summary: { type: String, default: '', trim: true },
  body: { type: String, default: '' },
  category: { type: String, enum: CATEGORIES, required: true },
  imagePath: { type: String, default: '' }
}, { _id: false })

const editorDraftSchema = new mongoose.Schema({
  article: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true, unique: true },
  editor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: editorContentSchema, required: true }
}, { timestamps: true })

editorDraftSchema.index({ article: 1 }, { unique: true })

module.exports = mongoose.model('EditorDraft', editorDraftSchema)
