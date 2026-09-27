const mongoose = require('mongoose')

// Pictures live in MongoDB rather than on disk, so everyone working on the
// project sees the same ones. GridFS is the driver's own file storage - it
// splits a file across two collections it manages itself.
const BUCKET = 'images'
const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

function getBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET })
}

// Returns the path the browser will ask for later. The type goes in metadata
// because the driver dropped its own contentType field in version 7.
function saveImage(buffer, { filename, contentType }) {
  return new Promise((resolve, reject) => {
    const upload = getBucket().openUploadStream(filename, { metadata: { contentType } })
    upload.on('error', reject)
    upload.on('finish', () => resolve(`/images/${upload.id}`))
    upload.end(buffer)
  })
}

async function findImage(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null
  const [file] = await getBucket().find({ _id: new mongoose.Types.ObjectId(id) }).toArray()
  return file || null
}

function openImage(id) {
  return getBucket().openDownloadStream(new mongoose.Types.ObjectId(id))
}

// The edit page shows the file name, and the only place it is kept is the
// GridFS record, so it has to be looked up from the stored path.
async function findImageName(url) {
  const match = /^\/images\/([a-f0-9]{24})$/i.exec(url || '')
  if (!match) return null

  const file = await findImage(match[1])
  return file ? file.filename : null
}

module.exports = { saveImage, findImage, openImage, findImageName, MAX_BYTES, ALLOWED_TYPES }
