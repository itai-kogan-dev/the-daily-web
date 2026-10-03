// The sidebar weather widget. Every page with a sidebar asks for it, so the
// answer is cached here and the weather service hears from us at most once
// per CACHE_MS, however many readers there are.
//
// Open-Meteo rather than OpenWeather: it needs no API key, so there is no
// secret to share between four laptops and nothing to leak into the repo.

const CACHE_MS = 15 * 60 * 1000   // the spec allows up to 15 minutes old
const TIMEOUT_MS = 5000

const CITY = process.env.WEATHER_CITY || 'Tel Aviv'
const LATITUDE = process.env.WEATHER_LAT || '32.08'
const LONGITUDE = process.env.WEATHER_LON || '34.78'

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

let cached = null     // { data, fetchedAt }
let inFlight = null   // the request already on its way, if there is one

async function fetchWeather() {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.search = new URLSearchParams({
    latitude: LATITUDE,
    longitude: LONGITUDE,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '1'
  })

  // without a timeout a hung weather service would hang every sidebar with it
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`weather service answered ${res.status}`)
  const body = await res.json()

  const now = body.current
  const { text, icon } = describe(now.weather_code, now.is_day)
  return {
    city: CITY,
    temperature: Math.round(now.temperature_2m),
    feelsLike: Math.round(now.apparent_temperature),
    high: Math.round(body.daily.temperature_2m_max[0]),
    low: Math.round(body.daily.temperature_2m_min[0]),
    humidity: now.relative_humidity_2m,
    wind: Math.round(now.wind_speed_10m),
    description: text,
    icon
  }
}

// Fresh cache -> the cache. Otherwise one request goes out, and anyone who
// asks while it is on its way waits for that same one instead of sending
// their own - a cold cache under load would otherwise mean a request per reader.
//
// If the weather service is down we keep serving the last answer, marked
// stale, rather than an error: yesterday's temperature beats an empty box.
async function getWeather() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return { ...cached.data, fetchedAt: new Date(cached.fetchedAt), stale: false }
  }

  if (!inFlight) {
    inFlight = fetchWeather()
      .then(data => { cached = { data, fetchedAt: Date.now() } })
      .catch(err => {
        // logged here, once per failed refresh, not once per waiting reader
        console.error('[weather] could not refresh -', err.message)
        throw err
      })
      .finally(() => { inFlight = null })
  }

  try {
    await inFlight
  } catch {
    if (!cached) throw Object.assign(new Error('Weather is not available right now'), { status: 503 })
    return { ...cached.data, fetchedAt: new Date(cached.fetchedAt), stale: true }
  }

  return { ...cached.data, fetchedAt: new Date(cached.fetchedAt), stale: false }
}

module.exports = { getWeather, CACHE_MS }
