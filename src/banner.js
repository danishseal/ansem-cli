// Animated ANSEMCHAIN banner: block letters with a diagonal green wave.

import { fg, RESET, bold, green } from './ansi.js'

const FONT = {
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  S: [' ████', '█    ', ' ███ ', '    █', '████ '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  M: ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  H: ['█   █', '█   █', '█████', '█   █', '█   █'],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
}

const WORD = 'ANSEMCHAIN'
export const BANNER_ROWS = 5

// 256-color greens, ping-pong so the wave cycles smoothly.
const WAVE = [22, 28, 34, 40, 46, 82, 118, 154, 118, 82, 46, 40, 34, 28]

// Plain (uncolored) banner rows, built once.
const ROWS = Array.from({ length: BANNER_ROWS }, (_, r) =>
  WORD.split('')
    .map((ch) => FONT[ch][r])
    .join('  ')
)

export const BANNER_WIDTH = ROWS[0].length

// Returns the banner lines for one animation frame, centered to `width`.
export function renderBanner(frame, width) {
  if (width < BANNER_WIDTH + 2) {
    // Narrow terminal: single-line fallback, still pulsing.
    const c = WAVE[frame % WAVE.length]
    return [fg(c) + bold('A N S E M C H A I N') + RESET]
  }
  const pad = ' '.repeat(Math.floor((width - BANNER_WIDTH) / 2))
  const lines = []
  for (let y = 0; y < BANNER_ROWS; y++) {
    const row = ROWS[y]
    let line = pad
    let cur = -1
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (ch === ' ') {
        line += ' '
        continue
      }
      // Diagonal wave: color band moves left-to-right over time.
      const c = WAVE[(Math.floor(x / 3) + y + frame) % WAVE.length]
      if (c !== cur) {
        line += fg(c)
        cur = c
      }
      line += ch
    }
    lines.push(line + RESET)
  }
  return lines
}

export function subtitle(text, width) {
  const t = text
  const pad = ' '.repeat(Math.max(0, Math.floor((width - t.length) / 2)))
  return pad + green(t)
}
