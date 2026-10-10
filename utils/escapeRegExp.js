// so "(" or "." typed into a search is matched as is, not read as regex syntax.
// Null characters are dropped: MongoDB refuses a pattern that contains one.
function escapeRegExp(text) {
  return text.replace(/\0/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = { escapeRegExp }
