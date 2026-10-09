// The sidebar weather widget. Every page with a sidebar asks for it, so the
// answer is cached here and the weather service hears from us at most once
// per CACHE_MS per place, however many readers there are.
//
// Open-Meteo rather than OpenWeather: it needs no API key, so there is no
// secret to share between four laptops and nothing to leak into the repo.

const CACHE_MS = 15 * 60 * 1000   // the spec allows up to 15 minutes old
const TIMEOUT_MS = 5000

// Readers send where they are, rounded to a tenth of a degree (about 11 km).
// That is plenty for weather, it means a whole city shares one cache entry
// instead of one per street, and we never hold anyone's exact location.
const PRECISION = 10
// A cap on how many places we remember, so readers from all over the world
// cannot grow the cache without limit. The oldest place goes first.
const MAX_PLACES = 500

// Where readers who don't share a location get their weather from.
const DEFAULT_PLACE = {
  city: process.env.WEATHER_CITY || 'Tel Aviv',
  lat: Number(process.env.WEATHER_LAT || 32.08),
  lon: Number(process.env.WEATHER_LON || 34.78)
}

// WMO weather codes, which is what Open-Meteo reports. Grouped, since the
// widget has no room for "moderate freezing drizzle".
const CONDITIONS = [
  { codes: [0],                      text: 'Clear',         icon: '☀️', night: '🌙' },
  { codes: [1, 2],                   text: 'Partly cloudy', icon: '⛅' },
  { codes: [3],                      text: 'Cloudy',        icon: '☁️' },
  { codes: [45, 48],                 text: 'Fog',           icon: '🌫️' },
  { codes: [51, 53, 55, 56, 57],     text: 'Drizzle',       icon: '🌦️' },
  { codes: [61, 63, 65, 66, 67],     text: 'Rain',          icon: '🌧️' },
  { codes: [80, 81, 82],             text: 'Showers',       icon: '🌧️' },
  { codes: [71, 73, 75, 77, 85, 86], text: 'Snow',          icon: '🌨️' },
  { codes: [95, 96, 99],             text: 'Thunderstorm',  icon: '⛈️' }
]

function describe(code, isDay) {
  const condition = CONDITIONS.find(one => one.codes.includes(code))
  if (!condition) return { text: 'Unknown', icon: '🌡️' }
  return { text: condition.text, icon: !isDay && condition.night ? condition.night : condition.icon }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

const round = value => Math.round(value * PRECISION) / PRECISION

// Both or neither: no coordinates is the default place, one of the two or a
// value off the globe is a bad request rather than a silent Tel Aviv.
function resolvePlace(lat, lon) {
  const given = [lat, lon].filter(value => value !== undefined && value !== '')
  if (given.length === 0) return DEFAULT_PLACE
  if (given.length === 1) throw httpError(400, 'Send both lat and lon, or neither')

  const latitude = Number(lat)
  const longitude = Number(lon)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw httpError(400, 'lat and lon must be a real place')
  }
  // Open-Meteo has no city names for coordinates, so the widget says "near you"
  return { city: null, lat: round(latitude), lon: round(longitude) }
}

async function fetchWeather(place) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.search = new URLSearchParams({
    latitude: place.lat,
    longitude: place.lon,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '1'
  })

  // without a timeout a hung weather service would hang every sidebar with it
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`weather service answered ${res.status}`)
  const body = await res.json()

  // a changed or broken answer should be a clear error in our log, not a
  // TypeError somewhere below
  const now = body && body.current
  const daily = body && body.daily
  if (!now || typeof now.temperature_2m !== 'number' ||
      !daily || !Array.isArray(daily.temperature_2m_max) || !Array.isArray(daily.temperature_2m_min)) {
    throw new Error('weather service sent an answer we do not understand')
  }

  const { text, icon } = describe(now.weather_code, now.is_day)
  return {
    city: place.city,
    temperature: Math.round(now.temperature_2m),
    feelsLike: Math.round(now.apparent_temperature),
    high: Math.round(daily.temperature_2m_max[0]),
    low: Math.round(daily.temperature_2m_min[0]),
    humidity: now.relative_humidity_2m,
    wind: Math.round(now.wind_speed_10m),
    description: text,
    icon
  }
}

const cache = new Map()      // place key -> { data, fetchedAt }, oldest first
const inFlight = new Map()   // place key -> the request already on its way

function remember(key, entry) {
  // delete and set again, so a refreshed place moves to the back of the line
  cache.delete(key)
  cache.set(key, entry)
  if (cache.size > MAX_PLACES) cache.delete(cache.keys().next().value)
}

function answer(entry, stale) {
  return { ...entry.data, fetchedAt: new Date(entry.fetchedAt), stale }
}

// Fresh cache -> the cache. Otherwise one request goes out per place, and
// anyone who asks for that place while it is on its way waits for that same
// one instead of sending their own - a cold cache under load would otherwise
// mean a request per reader.
//
// If the weather service is down we keep serving the last answer, marked
// stale, rather than an error: an hour old temperature beats an empty box.
async function getWeather({ lat, lon } = {}) {
  const place = resolvePlace(lat, lon)
  const key = `${place.lat},${place.lon}`

  const cached = cache.get(key)
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return answer(cached, false)

  let pending = inFlight.get(key)
  if (!pending) {
    pending = fetchWeather(place)
      .then(data => remember(key, { data, fetchedAt: Date.now() }))
      .catch(err => {
        // logged here, once per failed refresh, not once per waiting reader
        console.error('[weather] could not refresh', key, '-', err.message)
        throw err
      })
      .finally(() => inFlight.delete(key))
    inFlight.set(key, pending)
  }

  try {
    await pending
  } catch {
    const last = cache.get(key)
    if (!last) throw httpError(503, 'Weather is not available right now')
    return answer(last, true)
  }

  return answer(cache.get(key), false)
}

module.exports = { getWeather, CACHE_MS, MAX_PLACES }
