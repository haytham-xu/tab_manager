import { PNG } from 'pngjs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('../public/icons/', import.meta.url))
for (const size of [16, 32, 48, 128]) {
  const image = PNG.sync.read(await readFile(`${directory}/icon${size}.png`))
  if (image.width !== size || image.height !== size) throw new Error(`Invalid ${size}px extension icon dimensions.`)
}