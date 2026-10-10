// The message to show for a failed API call. API errors answer { error };
// no response at all means the request never reached the server.
async function readError(res) {
  if (!res) return 'Could not reach the server'
  try {
    return (await res.json()).error || 'Something went wrong'
  } catch {
    return 'Something went wrong'
  }
}
