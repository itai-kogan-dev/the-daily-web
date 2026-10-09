const express = require('express')
const imageStore = require('../services/imageStore')

const router = express.Router()

// Browsers speak HTTP, not MongoDB, so something has to read the bytes back
// out and stream them. This is what express.static does for files on disk.
router.get('/:id', async (req, res, next) => {
  const file = await imageStore.findImage(req.params.id)
  if (!file) return next()

  res.set('Content-Type', file.metadata.contentType)
  // an id never points at different bytes, so it can be cached hard
  res.set('Cache-Control', 'public, max-age=31536000, immutable')

  // A stream error with no listener is an uncaught exception and takes the
  // whole server down. Hand it to the error handler instead - by then the
  // headers are sent, so it can only log and close the connection.
  const stream = imageStore.openImage(req.params.id)
  stream.on('error', err => {
    if (!res.headersSent) return next(err)
    res.destroy()
  })
  stream.pipe(res)
})

module.exports = router
