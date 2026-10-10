// An error with an HTTP status. The error handler sends err.status and
// err.message to the client as they are, so the message is written for them.
function makeError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

module.exports = { makeError }
