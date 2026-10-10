const fs = require('fs')
const path = require('path')
const util = require('util')

// Copies everything the server logs into logs/app-YYYY-MM-DD.log, with a time
// and a level. console is wrapped once at startup, so no log call has to
// change. Files older than LOG_KEEP_DAYS are deleted.

const LEVELS = { log: 'INFO ', info: 'INFO ', warn: 'WARN ', error: 'ERROR' }

const pad = (n, width = 2) => String(n).padStart(width, '0')

// local time with its offset, so a line reads as the time it happened here
// and still converts exactly to any other zone
function formatTimestamp(date = new Date()) {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return `${formatLocalDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

function formatLocalDay(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function startLogFile({
  dir = process.env.LOG_DIR || path.join(__dirname, '..', 'logs'),
  keepDays = Number(process.env.LOG_KEEP_DAYS) || 14
} = {}) {
  let day = null
  let fd = null

  // Synchronous writes, on purpose. An uncaught exception logs and then
  // exits straight away - a buffered stream would lose exactly that line,
  // the one we most need. Appending a line is microseconds at our scale.
  function write(level, args) {
    try {
      const today = formatLocalDay()
      if (today !== day) openFor(today)
      fs.writeSync(fd, `${formatTimestamp()} ${LEVELS[level]} ${util.format(...args)}\n`)
    } catch (err) {
      // a full disk or a deleted folder must never take the server down -
      // the terminal still has everything
      if (!write.failed) original.error('[log] could not write to the log file -', err.message)
      write.failed = true
    }
  }

  function openFor(today) {
    if (fd !== null) fs.closeSync(fd)
    fs.mkdirSync(dir, { recursive: true })
    fd = fs.openSync(path.join(dir, `app-${today}.log`), 'a')
    day = today
    removeOld()
  }

  // runs at startup and whenever the day changes
  function removeOld() {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000
    for (const name of fs.readdirSync(dir)) {
      const match = /^app-(\d{4})-(\d{2})-(\d{2})\.log$/.exec(name)
      if (!match) continue
      const fileDay = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      if (fileDay.getTime() < cutoff) fs.unlinkSync(path.join(dir, name))
    }
  }

  const original = {}
  for (const level of Object.keys(LEVELS)) {
    original[level] = console[level].bind(console)
    console[level] = (...args) => {
      original[level](...args)
      write(level, args)
    }
  }

  write('log', [`[log] writing to ${dir}`])
  return { dir, file: () => path.join(dir, `app-${day}.log`) }
}

module.exports = { startLogFile, formatTimestamp }
