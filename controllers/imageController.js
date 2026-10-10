const express = require('express')
const imageStore = require('../services/imageStore')
const { makeError } = require('../utils/makeError')

// Stores a picture and hands back the path to it. The article is not touched
// here - the page puts the path in the form and the next autosave carries it
// like any other field.
async function uploadImage(req, res) {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw makeError(400, 'No picture received')
  }

  const url = await imageStore.saveImage(req.body, {
    filename: (req.get('X-Image-Name') || 'image').slice(0, 120),
    contentType: req.get('Content-Type')
  })

  res.status(201).json({ url })
}

// The picture arrives as the raw request body rather than a form upload, so
// express reads it on its own and no multipart library is needed. Used by
// both the reporter's and the editor's routes.
const upload = [
  express.raw({ type: imageStore.ALLOWED_TYPES, limit: imageStore.MAX_BYTES }),
  uploadImage
]

module.exports = { upload }
