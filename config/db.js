const mongoose = require('mongoose')

async function connectDb() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is missing - copy .env.example to .env')

  // how long the driver waits to find the server - at startup and on every
  // query after it. The default 30s is a long time to sit on a dead request,
  // and at startup it means a vague failure instead of a quick clear one
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
  console.log('[db] connected')

  // Mongoose reconnects on its own after a network blip. These lines log it,
  // so requests that failed in between are not mistaken for a bug.

  // 'disconnecting' only fires when we close the connection ourselves (the
  // seed does, when it is done) - that is not worth an error line
  let closing = false
  mongoose.connection.on('disconnecting', () => { closing = true })
  mongoose.connection.on('disconnected', () => {
    if (!closing) console.error('[db] disconnected')
  })
  mongoose.connection.on('reconnected', () => console.log('[db] reconnected'))
  mongoose.connection.on('error', err => console.error('[db] error -', err.message))

  return mongoose.connection
}

module.exports = { connectDb }
