const { getWeather } = require('../services/weather')

// The sidebar widget, open to guests. Query: lat and lon, both required -
// there is no default place.
async function showWeather(req, res) {
  const weather = await getWeather({ lat: req.query.lat, lon: req.query.lon })

  // The browser may keep the answer only until the server's copy runs out,
  // so the two caches never add up. A stale answer is not kept at all.
  const left = Math.floor((weather.expiresAt.getTime() - Date.now()) / 1000)
  res.set('Cache-Control', weather.stale || left <= 0 ? 'no-cache' : `public, max-age=${left}`)
  res.json(weather)
}

module.exports = { showWeather }
