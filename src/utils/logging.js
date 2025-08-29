// src/utils/logging.js
export function now() {
  return Date.now();
}
export function ms(since) {
  return `${Date.now() - since}ms`;
}
export function logStart(tag, msg = "") {
  console.log(`[${tag}] START ${msg}`);
  return now();
}
export function logDone(tag, startedAt, msg = "") {
  console.log(`[${tag}] DONE in ${ms(startedAt)} ${msg}`);
}
export function logInfo(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}
export function newReqId() {
  return Math.random().toString(36).slice(2, 8);
}