// Minimal ANSI toolkit. Zero deps so `npx ansem` cold-starts fast.

const ESC = '\x1b['

export const cursor = {
  hide: ESC + '?25l',
  show: ESC + '?25h',
  home: ESC + 'H',
}

export const screen = {
  alt: ESC + '?1049h',
  main: ESC + '?1049l',
  clearBelow: ESC + '0J',
  clearLine: ESC + 'K',
}

export const RESET = ESC + '0m'
export const fg = (n) => ESC + `38;5;${n}m`
export const bold = (s) => ESC + '1m' + s + RESET
export const dim = (s) => ESC + '2m' + s + RESET
export const inv = (s) => ESC + '7m' + s + RESET
export const color = (n, s) => fg(n) + s + RESET

export const green = (s) => color(46, s)
export const softGreen = (s) => color(40, s)
export const red = (s) => color(196, s)
export const yellow = (s) => color(220, s)
export const gray = (s) => color(245, s)
export const cyan = (s) => color(51, s)

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g
export const stripAnsi = (s) => s.replace(ANSI_RE, '')
export const visLen = (s) => stripAnsi(s).length

// Truncate a string to `w` visible chars, preserving escape codes.
export function truncVis(s, w) {
  if (visLen(s) <= w) return s
  let out = ''
  let n = 0
  let i = 0
  while (i < s.length && n < w - 1) {
    const m = /^\x1b\[[0-9;?]*[A-Za-z]/.exec(s.slice(i))
    if (m) {
      out += m[0]
      i += m[0].length
    } else {
      out += s[i]
      i += 1
      n += 1
    }
  }
  return out + RESET + '…'
}

export function padVis(s, w) {
  const t = truncVis(s, w)
  return t + ' '.repeat(Math.max(0, w - visLen(t)))
}
