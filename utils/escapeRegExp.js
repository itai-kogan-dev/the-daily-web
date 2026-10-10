// so "(" or "." typed into a search is matched as is, not read as regex syntax
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = { escapeRegExp }
