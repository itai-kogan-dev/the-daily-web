// The weather for the sidebar, from Open-Meteo (free, no API key) with the
// place name from OpenStreetMap's Nominatim. Cached per place, so the services
// hear from us at most once per CACHE_MS per place, however many readers.

const { makeError } = require('../utils/makeError')

const CACHE_MS = 15 * 60 * 1000   // the spec allows up to 15 minutes old
// Open-Meteo's "current" is itself a reading taken up to 15 minutes before we
// ask. The cache runs out 15 minutes after that reading, not after our fetch,
// so what readers see is never more than 15 minutes behind it. When the
// reading is already old, a fresh one is fetched at most once a minute.
const MIN_REFRESH_MS = 60 * 1000
const TIMEOUT_MS = 5000

// Readers send where they are, rounded to a tenth of a degree (about 11 km).
// That is plenty for weather, it means a whole city shares one cache entry
// instead of one per street, and we never hold anyone's exact location.
const PRECISION = 10
// A cap on how many places we remember, so readers from all over the world
// cannot grow the cache without limit. The oldest place goes first.
const MAX_PLACES = 500

// Nominatim's rules: say who we are, and at most one request a second.
// A town's name never changes, so each place is looked up once and kept.
const NOMINATIM_AGENT = 'TheDailyWeb/1.0 (course project; https://github.com/itai-kogan-dev/the-daily-web)'
const NOMINATIM_GAP_MS = 1100

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

const round = value => Math.round(value * PRECISION) / PRECISION

// There is no default place: weather for somewhere the reader is not would
// look like theirs. Without a location the widget says so instead.
function resolvePlace(lat, lon) {
  const given = [lat, lon].filter(value => value !== undefined && value !== '')
  if (given.length < 2) throw makeError(400, 'Send lat and lon')

  const latitude = Number(lat)
  const longitude = Number(lon)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw makeError(400, 'lat and lon must be a real place')
  }
  return { lat: round(latitude), lon: round(longitude) }
}

const names = new Map()   // place key -> name, oldest first
let nextNameAt = 0        // when Nominatim may next be asked

// The city, town or village a place is in, or null if Nominatim cannot say.
// A missing name never costs the reader their weather - the widget falls
// back to "near you".
async function findPlaceName(place, key) {
  if (names.has(key)) return names.get(key)

  // queue behind the previous lookup, so a burst of new places still asks
  // Nominatim at most once a second
  const wait = Math.max(0, nextNameAt - Date.now())
  nextNameAt = Date.now() + wait + NOMINATIM_GAP_MS
  if (wait) await new Promise(resolve => setTimeout(resolve, wait))

  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse')
    url.search = new URLSearchParams({
      format: 'jsonv2', lat: place.lat, lon: place.lon,
      zoom: '10',                 // city level - we never want a street
      'accept-language': 'en'
    })
    const res = await fetch(url, {
      headers: { 'User-Agent': NOMINATIM_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`answered ${res.status}`)
    const body = await res.json()
    const address = body.address || {}
    const name = address.city || address.town || address.village || address.municipality || body.name || null

    // only an answer is kept; a failure is tried again next time
    names.set(key, name)
    if (names.size > MAX_PLACES) names.delete(names.keys().next().value)
    return name
  } catch (err) {
    console.error('[weather] could not name', key, '-', err.message)
    return null
  }
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

  // the reading's time comes as local time plus the place's UTC offset
  const observed = Date.parse(now.time + 'Z') - (body.utc_offset_seconds || 0) * 1000

  const { text, icon } = describe(now.weather_code, now.is_day)
  return {
    observedAt: Number.isFinite(observed) ? new Date(observed).toISOString() : null,
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

// 15 minutes after the reading, never longer than 15 minutes after our fetch,
// and at least a minute so an old reading does not mean a fetch per reader
function computeExpiry(data, fetchedAt) {
  const observed = data.observedAt ? Date.parse(data.observedAt) : fetchedAt
  return Math.min(fetchedAt + CACHE_MS, Math.max(fetchedAt + MIN_REFRESH_MS, observed + CACHE_MS))
}

function formatAnswer(entry, stale) {
  return { ...entry.data, fetchedAt: new Date(entry.fetchedAt), expiresAt: new Date(entry.expiresAt), stale }
}

// Served from the cache while it is under 15 minutes old. Otherwise one request
// goes out per place, and readers asking for that place meanwhile wait for it
// instead of sending their own. If the weather service is down, the last
// answer is served marked stale - it can then be older than 15 minutes.
async function getWeather({ lat, lon } = {}) {
  const place = resolvePlace(lat, lon)
  const key = `${place.lat},${place.lon}`

  const cached = cache.get(key)
  if (cached && Date.now() < cached.expiresAt) return formatAnswer(cached, false)

  let pending = inFlight.get(key)
  if (!pending) {
    pending = Promise.all([fetchWeather(place), findPlaceName(place, key)])
      .then(([data, city]) => {
        const fetchedAt = Date.now()
        remember(key, { data: { city, ...data }, fetchedAt, expiresAt: computeExpiry(data, fetchedAt) })
      })
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
    if (!last) throw makeError(503, 'Weather is not available right now')
    return formatAnswer(last, true)
  }

  return formatAnswer(cache.get(key), false)
}

module.exports = { getWeather }
