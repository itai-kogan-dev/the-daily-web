const { getWeather, CACHE_MS } = require('../services/weather')

// The sidebar widget, open to guests. Query: lat and lon, both required -
// there is no default place.
async function showWeather(req, res) {
  const weather = await getWeather({ lat: req.query.lat, lon: req.query.lon })

  // The browser may keep the answer only for what is left of its 15 minutes.
  // A flat max-age on top of the server cache would add up: an answer handed
  // out at 14 minutes old, kept 5 more, is shown at 19.
  // A stale answer (weather service down) is not kept at all, so the next
  // page asks again and gets fresh weather as soon as there is some.
  const left = Math.floor((CACHE_MS - (Date.now() - weather.fetchedAt.getTime())) / 1000)
  res.set('Cache-Control', weather.stale || left <= 0 ? 'no-cache' : `public, max-age=${left}`)
  res.json(weather)
}

module.exports = { showWeather }
