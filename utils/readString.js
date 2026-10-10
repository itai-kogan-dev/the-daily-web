// A request body or query can carry anything - a number, a list, an object.
// Only text counts; anything else reads as an empty string.
function readString(value) {
  return typeof value === 'string' ? value : ''
}

module.exports = { readString }
