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

  imageStore.openImage(req.params.id).pipe(res)
})

module.exports = router
