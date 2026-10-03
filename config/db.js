const mongoose = require('mongoose')

async function connectDb() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is missing - copy .env.example to .env')

  // fail in 10 seconds with a clear message, not 30 with a vague one
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
  console.log('[db] connected')

  // Mongoose reconnects on its own after a network blip; these lines are how
  // we find out it happened, and that requests failing in between were not a
  // bug in the code
  mongoose.connection.on('disconnected', () => console.error('[db] disconnected'))
  mongoose.connection.on('reconnected', () => console.log('[db] reconnected'))
  mongoose.connection.on('error', err => console.error('[db] error -', err.message))

  return mongoose.connection
}

module.exports = { connectDb }
