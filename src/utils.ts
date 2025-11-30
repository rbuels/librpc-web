export function uuid() {
  return Math.floor((1 + Math.random()) * 1e10).toString(16)
}
