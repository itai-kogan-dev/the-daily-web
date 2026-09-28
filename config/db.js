const mongoose = require('mongoose')

async function connectDb() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is missing - copy .env.example to .env')

  await mongoose.connect(uri)
  console.log('[db] connected')
  return mongoose.connection
}

module.exports = { connectDb }
