const express = require('express')
const { getWeather } = require('../services/weather')

const router = express.Router()

// the sidebar widget, open to guests. The server keeps its own 15 minute
// cache; the browser may keep the answer for 5 of those
router.get('/', async (req, res) => {
  const weather = await getWeather()
  res.set('Cache-Control', 'public, max-age=300')
  res.json(weather)
})

module.exports = router
